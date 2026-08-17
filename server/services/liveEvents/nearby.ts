import { getConfig } from "../../config";
import {
  findNearbyEvents,
  getUserLivePreferences,
  listFollowedJambaseIds,
} from "../../db/liveEvents";
import { resolvePreferences } from "./notice";
import { loadGenreWeights, rankByAffinity } from "./affinity";
import type { ScoredEvent } from "./affinity";

export type NearbyEntry = ScoredEvent & {
  following: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function calendarDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * The nearby shelf: a short window, a tight radius, ranked by taste and floored
 * so it can be empty.
 *
 * Scope is deliberately tighter than the banner's. The banner has a strong
 * signal (you follow them) so it can afford wide geography and a long horizon;
 * this is speculative, so it gets neither. Weak signal plus far away plus far
 * ahead is noise.
 */
export async function getNearbyShows(
  userId: number,
  now: number = Date.now()
): Promise<NearbyEntry[]> {
  const { liveEvents } = getConfig();
  const prefs = resolvePreferences(await getUserLivePreferences(userId));

  if (prefs.lat === null || prefs.lon === null) return [];

  const [events, weights, followedIds] = await Promise.all([
    findNearbyEvents(userId, {
      lat: prefs.lat,
      lon: prefs.lon,
      radiusKm: prefs.radiusKm,
      from: calendarDay(now),
      to: calendarDay(now + liveEvents.shelfHorizonDays * DAY_MS),
    }),
    loadGenreWeights(userId),
    listFollowedJambaseIds(),
  ]);

  const followed = new Set(followedIds);

  // Followed artists are not filtered out: a hole where the banner's event
  // should be reads as a bug, and the duplication reads as emphasis.
  return rankByAffinity(events, weights, liveEvents.shelfMinAffinity).map(
    (scored) => ({
      ...scored,
      following: scored.event.performers.some((performer) =>
        followed.has(performer.artist_jambase_id)
      ),
    })
  );
}
