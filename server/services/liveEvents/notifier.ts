import {
  listUsersWithResolvedFollows,
  findFollowedUpcomingEvents,
  getUserLivePreferences,
  markNotified,
} from "../../db/liveEvents";
import type { HydratedLiveEvent } from "../../db/liveEvents";
import { notifyLiveEvent, notifyLiveStatusChange } from "../notifications";
import { evaluate, resolvePreferences } from "./notice";
import type { EffectivePreferences, NoticeCandidate } from "./notice";
import { createLogger } from "../../logger";

export type NotifyOutcome = {
  announced: number;
  statusChanges: number;
};

const log = createLogger("live-notifier");

const DAY_MS = 24 * 60 * 60 * 1000;

function venueOf(event: HydratedLiveEvent): string {
  return (
    [event.venue_name, event.venue_city].filter(Boolean).join(", ") ||
    "a venue nearby"
  );
}

function artistOf(event: HydratedLiveEvent): string {
  const lead = event.performers.find((performer) => performer.is_headliner);
  return lead?.artist_name ?? event.performers[0]?.artist_name ?? event.name;
}

/**
 * A status change re-notifies even when the event was already announced, but
 * only once per change: gating on `status_changed_at` being newer than
 * `notified_at` keeps it from firing on every poll.
 */
function needsStatusNotice(candidate: NoticeCandidate): boolean {
  if (candidate.reason !== "status-changed") return false;

  const notifiedAt = candidate.event.state?.notified_at;
  if (!notifiedAt) return true;

  const changedAt = candidate.event.status_changed_at;
  return changedAt !== null && Date.parse(changedAt) > Date.parse(notifiedAt);
}

async function notifyOne(
  userId: number,
  candidate: NoticeCandidate,
  at: string
): Promise<"status" | "announce" | null> {
  const shared = {
    userId,
    artistName: artistOf(candidate.event),
    venue: venueOf(candidate.event),
    eventDate: candidate.event.event_date,
    tier:
      candidate.tier === "local" ? ("local" as const) : ("regional" as const),
  };

  if (needsStatusNotice(candidate)) {
    const status = candidate.event.event_status;
    if (status === "scheduled") return null;
    await notifyLiveStatusChange({ ...shared, status });
    await markNotified(userId, candidate.event.id, at);
    return "status";
  }

  if (candidate.event.state?.notified_at) return null;

  await notifyLiveEvent(shared);
  await markNotified(userId, candidate.event.id, at);
  return "announce";
}

async function notifyUserEvents(
  userId: number,
  prefs: EffectivePreferences,
  now: number,
  at: string,
  outcome: NotifyOutcome
): Promise<void> {
  const from = new Date(now).toISOString().slice(0, 10);
  const to = new Date(now + prefs.bannerHorizonDays * DAY_MS)
    .toISOString()
    .slice(0, 10);

  const events = await findFollowedUpcomingEvents(userId, {
    from,
    to,
    countries: null,
  });

  for (const event of events) {
    const candidate = evaluate(event, prefs, now);
    if (!candidate) continue;

    const result = await notifyOne(userId, candidate, at);
    if (result === "status") outcome.statusChanges += 1;
    else if (result === "announce") outcome.announced += 1;
  }
}

/**
 * Banner-worthy means notification-worthy. The shelf never notifies, so there
 * is no separate notification configuration to reason about: this reuses the
 * notice service's own evaluation rather than duplicating the windows.
 */
export async function notifyLiveUpdates(
  now: number = Date.now()
): Promise<NotifyOutcome> {
  const outcome: NotifyOutcome = { announced: 0, statusChanges: 0 };
  const userIds = await listUsersWithResolvedFollows();
  const at = new Date(now).toISOString();

  for (const userId of userIds) {
    try {
      const prefs = resolvePreferences(await getUserLivePreferences(userId));
      await notifyUserEvents(userId, prefs, now, at, outcome);
    } catch (error) {
      log.error(`Could not notify user ${userId}`, error);
    }
  }

  if (outcome.announced || outcome.statusChanges) {
    log.info(
      `Notified ${outcome.announced} new date(s) and ${outcome.statusChanges} status change(s)`
    );
  }
  return outcome;
}
