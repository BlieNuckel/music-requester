import express, { type Request, type Response } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { ApiError } from "../middleware/ApiError";
import {
  findAllForUser,
  findEventsForArtist,
  findJambaseIdForArtistMbid,
  markViewed,
  setUserResponse,
} from "../db/liveEvents";
import type { HydratedLiveEvent } from "../db/liveEvents";
import type { LiveEventResponse } from "../db/index";
import { selectNotice } from "../services/liveEvents/notice";
import { getNearbyShows } from "../services/liveEvents/nearby";
import {
  readLivePreferences,
  writeLivePreferences,
} from "../services/liveEvents/preferences";
import type { LivePreferencesPatch } from "../services/liveEvents/preferences";
import type { NoticeCandidate } from "../services/liveEvents/notice";

const router = express.Router();

const RESPONSES: LiveEventResponse[] = ["going", "dismissed"];

function serializeEvent(event: HydratedLiveEvent) {
  return {
    id: event.id,
    eventKey: event.event_key,
    name: event.name,
    eventDate: event.event_date,
    previousStartDate: event.previous_start_date,
    status: event.event_status,
    statusChangedAt: event.status_changed_at,
    venueName: event.venue_name,
    venueCity: event.venue_city,
    venueCountry: event.venue_country,
    ticketUrl: event.ticket_url,
    imageUrl: event.image_url,
    distanceKm: event.distanceKm,
    performers: event.performers.map((performer) => ({
      jambaseId: performer.artist_jambase_id,
      name: performer.artist_name,
      isHeadliner: performer.is_headliner,
    })),
    response: event.state?.response ?? null,
    viewedAt: event.state?.viewed_at ?? null,
  };
}

function serializeNotice(candidate: NoticeCandidate) {
  return {
    ...serializeEvent(candidate.event),
    tier: candidate.tier,
    reason: candidate.reason,
    distanceKm: candidate.distanceKm,
  };
}

function parseEventId(raw: string | string[] | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) {
    throw new ApiError(400, "Invalid event id");
  }
  return id;
}

router.use(requireAuth);

router.get("/preferences", async (req: Request, res: Response) => {
  res.json(await readLivePreferences(req.user!.id));
});

router.patch("/preferences", async (req: Request, res: Response) => {
  const patch = req.body as LivePreferencesPatch;
  res.json(await writeLivePreferences(req.user!.id, patch));
});

router.get("/notice", async (req: Request, res: Response) => {
  const { notice, additionalCount } = await selectNotice(req.user!.id);
  res.json({
    notice: notice ? serializeNotice(notice) : null,
    additionalCount,
  });
});

router.get("/nearby", async (req: Request, res: Response) => {
  const entries = await getNearbyShows(req.user!.id);
  res.json({
    events: entries.map((entry) => ({
      ...serializeEvent(entry.event),
      affinity: entry.affinity,
      matchedGenres: entry.matchedGenres,
      following: entry.following,
    })),
  });
});

router.get("/events", async (req: Request, res: Response) => {
  const past = req.query.past === "true";
  const response = req.query.response as LiveEventResponse | undefined;

  if (response !== undefined && !RESPONSES.includes(response)) {
    throw new ApiError(400, "Invalid response filter");
  }

  const events = await findAllForUser(req.user!.id, {
    past,
    now: new Date().toISOString().slice(0, 10),
    ...(response === undefined ? {} : { response }),
  });

  res.json({ events: events.map(serializeEvent) });
});

router.get("/artist/:mbid", async (req: Request, res: Response) => {
  const jambaseArtistId = await findJambaseIdForArtistMbid(
    String(req.params.mbid)
  );

  // Only artists somebody follows have ever been resolved, so an unfollowed
  // artist has no dates rather than an error.
  if (!jambaseArtistId) {
    res.json({ events: [] });
    return;
  }

  const events = await findEventsForArtist(req.user!.id, jambaseArtistId, {
    now: new Date().toISOString().slice(0, 10),
    includePast: req.query.includePast === "true",
  });

  res.json({ events: events.map(serializeEvent) });
});

router.post("/events/:id/response", async (req: Request, res: Response) => {
  const eventId = parseEventId(req.params.id);
  const { response } = req.body as { response?: LiveEventResponse | null };

  if (response !== null && !RESPONSES.includes(response as LiveEventResponse)) {
    throw new ApiError(400, "response must be 'going', 'dismissed', or null");
  }

  await setUserResponse(
    req.user!.id,
    eventId,
    response ?? null,
    new Date().toISOString()
  );
  res.json({ ok: true });
});

router.post("/events/:id/viewed", async (req: Request, res: Response) => {
  const eventId = parseEventId(req.params.id);
  await markViewed(req.user!.id, eventId, new Date().toISOString());
  res.json({ ok: true });
});

export default router;
