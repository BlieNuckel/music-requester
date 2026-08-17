import { getConfig } from "../../config";
import {
  distanceKm,
  findFollowedUpcomingEvents,
  getUserLivePreferences,
} from "../../db/liveEvents";
import type {
  HydratedLiveEvent,
  UserLivePreferences,
} from "../../db/liveEvents";

export type DistanceTier = "local" | "regional" | "out-of-scope";

export type EffectivePreferences = {
  radiusKm: number;
  lat: number | null;
  lon: number | null;
  regions: string[];
  announceDays: number;
  imminentDaysLocal: number;
  imminentDaysRegional: number;
  bannerEnabled: boolean;
  bannerHorizonDays: number;
};

export type NoticeCandidate = {
  event: HydratedLiveEvent;
  tier: DistanceTier;
  distanceKm: number | null;
  score: number;
  reason: NoticeReason;
};

/** Why this event is on screen, which is also the top of the ranking order. */
export type NoticeReason = "status-changed" | "just-announced" | "coming-up";

export type NoticeResult = {
  notice: NoticeCandidate | null;
  additionalCount: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** A status change outranks everything, including a user's own dismissal. */
const SCORE_STATUS_CHANGED = 10_000;
const SCORE_LOCAL = 1_000;
const SCORE_JUST_ANNOUNCED = 250;

export function resolvePreferences(
  prefs: UserLivePreferences | null
): EffectivePreferences {
  const { liveEvents } = getConfig();

  return {
    radiusKm: Math.min(
      prefs?.live_radius_km ?? liveEvents.sweepRadiusKm,
      liveEvents.sweepRadiusKm
    ),
    lat: prefs?.live_lat ?? liveEvents.originLat,
    lon: prefs?.live_lon ?? liveEvents.originLon,
    regions:
      prefs?.live_regions && prefs.live_regions.length > 0
        ? prefs.live_regions
        : liveEvents.regions,
    announceDays: prefs?.live_announce_days ?? liveEvents.announceDays,
    imminentDaysLocal:
      prefs?.live_imminent_days_local ?? liveEvents.imminentDaysLocal,
    imminentDaysRegional:
      prefs?.live_imminent_days_regional ?? liveEvents.imminentDaysRegional,
    bannerEnabled: prefs?.live_banner_enabled ?? true,
    bannerHorizonDays: liveEvents.bannerHorizonDays,
  };
}

/**
 * Local means "you could go on a weeknight"; regional means "you would have to
 * travel". They earn different lead times rather than different surfaces.
 */
export function classifyTier(
  event: Pick<HydratedLiveEvent, "venue_lat" | "venue_lon" | "venue_country">,
  prefs: EffectivePreferences
): { tier: DistanceTier; distanceKm: number | null } {
  const hasOrigin = prefs.lat !== null && prefs.lon !== null;
  const hasVenue = event.venue_lat !== null && event.venue_lon !== null;

  const distance =
    hasOrigin && hasVenue
      ? distanceKm(
          prefs.lat as number,
          prefs.lon as number,
          event.venue_lat as number,
          event.venue_lon as number
        )
      : null;

  if (distance !== null && distance <= prefs.radiusKm) {
    return { tier: "local", distanceKm: distance };
  }
  if (event.venue_country && prefs.regions.includes(event.venue_country)) {
    return { tier: "regional", distanceKm: distance };
  }
  return { tier: "out-of-scope", distanceKm: distance };
}

function imminentDaysFor(
  tier: DistanceTier,
  prefs: EffectivePreferences
): number {
  return tier === "local"
    ? prefs.imminentDaysLocal
    : prefs.imminentDaysRegional;
}

function daysUntil(eventDate: string, now: number): number {
  return (Date.parse(`${eventDate}T00:00:00Z`) - now) / DAY_MS;
}

function withinAnnounceWindow(
  since: string | null,
  announceDays: number,
  now: number
): boolean {
  if (!since) return false;
  const seen = Date.parse(since);
  return !Number.isNaN(seen) && now - seen < announceDays * DAY_MS;
}

function hasStatusChange(
  event: HydratedLiveEvent,
  prefs: EffectivePreferences,
  now: number
): boolean {
  if (event.event_status === "scheduled") return false;
  return withinAnnounceWindow(event.status_changed_at, prefs.announceDays, now);
}

/**
 * Two windows, OR'd: recently announced, or coming up soon. Between them an
 * event goes quiet and lives on /library/live, which is what stops a date six
 * months out from sitting in the banner for six months.
 */
export function evaluate(
  event: HydratedLiveEvent,
  prefs: EffectivePreferences,
  now: number
): NoticeCandidate | null {
  const { tier, distanceKm: distance } = classifyTier(event, prefs);
  if (tier === "out-of-scope") return null;

  const until = daysUntil(event.event_date, now);
  if (until < 0 || until > prefs.bannerHorizonDays) return null;

  const statusChanged = hasStatusChange(event, prefs, now);
  const response = event.state?.response ?? null;

  // A cancellation is the one thing worth overriding a user's own decision for,
  // and it matters most to whoever already bought tickets.
  if (!statusChanged && response !== null) return null;

  const announced = withinAnnounceWindow(
    event.first_seen_at,
    prefs.announceDays,
    now
  );
  const imminent = until <= imminentDaysFor(tier, prefs);
  if (!statusChanged && !announced && !imminent) return null;

  const reason: NoticeReason = statusChanged
    ? "status-changed"
    : announced
      ? "just-announced"
      : "coming-up";

  const score =
    (statusChanged ? SCORE_STATUS_CHANGED : 0) +
    (tier === "local" ? SCORE_LOCAL : 0) +
    (announced ? SCORE_JUST_ANNOUNCED : 0) +
    Math.max(0, prefs.bannerHorizonDays - until);

  return { event, tier, distanceKm: distance, score, reason };
}

export function rankNotices(
  candidates: readonly NoticeCandidate[]
): NoticeCandidate[] {
  return [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.event.event_date.localeCompare(b.event.event_date);
  });
}

/** The banner payload: the single most urgent notice, plus how many others. */
export async function selectNotice(
  userId: number,
  now: number = Date.now()
): Promise<NoticeResult> {
  const prefs = resolvePreferences(await getUserLivePreferences(userId));
  if (!prefs.bannerEnabled) return { notice: null, additionalCount: 0 };

  const from = new Date(now).toISOString().slice(0, 10);
  const to = new Date(now + prefs.bannerHorizonDays * DAY_MS)
    .toISOString()
    .slice(0, 10);

  const events = await findFollowedUpcomingEvents(userId, {
    from,
    to,
    countries: null,
  });

  const ranked = rankNotices(
    events
      .map((event) => evaluate(event, prefs, now))
      .filter((candidate): candidate is NoticeCandidate => candidate !== null)
  );

  return {
    notice: ranked[0] ?? null,
    additionalCount: Math.max(0, ranked.length - 1),
  };
}
