import { getConfig } from "../../config";
import {
  findNearbyEvents,
  getUserLivePreferences,
  listFollowedJambaseIds,
} from "../../db/liveEvents";
import { getArtistsImages } from "../../api/deezer/artists";
import { resolvePreferences } from "./notice";
import { loadGenreWeights, rankByAffinity } from "./affinity";
import type { ScoredEvent } from "./affinity";

export type NearbyEntry = ScoredEvent & {
  following: boolean;
  /**
   * Headliner photo, for events JamBase gave no image of. Kept separate from the
   * event's own `image_url` so the two sources stay distinguishable.
   */
  artistImageUrl: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Only as many as the shelf can show. Each name is a Deezer search, and the rest
 * of the ranked list is never rendered with an image.
 */
const IMAGE_LOOKUP_LIMIT = 6;

function calendarDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

function headlinerName(entry: NearbyEntry): string {
  const performers = entry.event.performers;
  const lead = performers.find((performer) => performer.is_headliner);
  return lead?.artist_name ?? performers[0]?.artist_name ?? entry.event.name;
}

/**
 * Fill in a headliner photo where the event has no image of its own, so the shelf
 * has something to show for every row rather than only some of them.
 */
async function attachArtistImages(
  entries: NearbyEntry[]
): Promise<NearbyEntry[]> {
  const missing = entries
    .slice(0, IMAGE_LOOKUP_LIMIT)
    .filter((entry) => !entry.event.image_url);
  if (missing.length === 0) return entries;

  const images = await getArtistsImages(missing.map(headlinerName));

  return entries.map((entry) => ({
    ...entry,
    artistImageUrl:
      images.get(headlinerName(entry).toLowerCase()) || entry.artistImageUrl,
  }));
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
  const ranked = rankByAffinity(
    events,
    weights,
    liveEvents.shelfMinAffinity
  ).map((scored) => ({
    ...scored,
    following: scored.event.performers.some((performer) =>
      followed.has(performer.artist_jambase_id)
    ),
    artistImageUrl: null,
  }));

  return attachArtistImages(ranked);
}
