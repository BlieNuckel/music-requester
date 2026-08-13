import { getSignalEvents } from "../db/userProfile";
import { isPlaceholderArtist } from "../utils/artistFilter";
import {
  ingestUserTrackPlays,
  latestRatings,
  reconstructPlayCounts,
  reconstructTrackPlayCounts,
  rollupToArtists,
} from "../services/profile/signalIngestion";
import type { UserSignalEvent } from "../db/entity/UserSignalEvent";

/** An artist with the effective weight (windowed plays × rating boost) the recommender ranks by. */
export type ArtistWeight = {
  name: string;
  viewCount: number;
};

function allTimeWeights(latest: Map<string, number>): ArtistWeight[] {
  return Array.from(latest, ([name, viewCount]) => ({ name, viewCount }));
}

/** Oldest `recorded_at` across both plays series, or null when neither has any events. */
function earliestRecordedAt(...series: UserSignalEvent[][]): number | null {
  const starts = series
    .map((events) => events[0])
    .filter((event): event is UserSignalEvent => event !== undefined)
    .map((event) => Date.parse(event.recorded_at));
  return starts.length === 0 ? null : Math.min(...starts);
}

/**
 * Cumulative all-time plays per artist at `cutoffMs`, merged across the track series and
 * the legacy artist series. Both are monotonic cumulative counts of the same quantity, so
 * the higher of the two is the safe estimate: it never under-counts a baseline (which would
 * inflate a windowed delta), and it lets the track series take over on its own as the
 * legacy series stops being written. Keyed by artist name, which is what the ratings series
 * joins on and the only key the legacy series has.
 */
export function reconstructArtistPlayCounts(
  trackEvents: UserSignalEvent[],
  legacyEvents: UserSignalEvent[],
  cutoffMs: number
): Map<string, number> {
  const merged = reconstructPlayCounts(legacyEvents, cutoffMs);
  const tracks = reconstructTrackPlayCounts(trackEvents, cutoffMs);
  for (const artist of rollupToArtists(tracks)) {
    if (!artist.name) continue;
    const known = merged.get(artist.name) ?? 0;
    merged.set(artist.name, Math.max(known, artist.playCount));
  }
  return merged;
}

/**
 * Per-artist play weight derived from the plays delta series. When the series spans the
 * full window, weight = plays within the window (cumulative count now minus the count
 * reconstructed at the window start). Until the series is that deep — or when nothing was
 * played in the window — weight falls back to the latest cumulative all-time count, so the
 * set is never empty and a thin history still produces sensible weights.
 */
export function derivePlayWeights(
  trackEvents: UserSignalEvent[],
  legacyEvents: UserSignalEvent[],
  now: number,
  windowMs: number
): ArtistWeight[] {
  const earliest = earliestRecordedAt(trackEvents, legacyEvents);
  if (earliest === null) return [];
  const latest = reconstructArtistPlayCounts(
    trackEvents,
    legacyEvents,
    Infinity
  );

  const windowStart = now - windowMs;
  if (earliest > windowStart) {
    return allTimeWeights(latest);
  }

  const baseline = reconstructArtistPlayCounts(
    trackEvents,
    legacyEvents,
    windowStart
  );
  const windowed: ArtistWeight[] = [];
  let total = 0;
  for (const [name, count] of latest) {
    const delta = Math.max(0, count - (baseline.get(name) ?? 0));
    total += delta;
    if (delta > 0) windowed.push({ name, viewCount: delta });
  }
  return total > 0 ? windowed : allTimeWeights(latest);
}

/**
 * Average rating (0–10) per artist, from the latest rating known for each rated item.
 * Items whose latest rating is `0` (un-rated) are excluded so a cleared star doesn't
 * drag an artist's average down.
 */
export function aggregateArtistRatings(
  ratingEvents: UserSignalEvent[]
): Map<string, number> {
  const totals = new Map<string, { sum: number; count: number }>();
  for (const payload of latestRatings(ratingEvents).values()) {
    if (!payload.artist || payload.rating <= 0) continue;
    const entry = totals.get(payload.artist) ?? { sum: 0, count: 0 };
    entry.sum += payload.rating;
    entry.count += 1;
    totals.set(payload.artist, entry);
  }
  const averages = new Map<string, number>();
  for (const [name, { sum, count }] of totals) {
    averages.set(name, sum / count);
  }
  return averages;
}

/** Boost each artist's play weight by its average rating: `× (1 + ratingWeight × avg/10)`. */
export function applyRatingMultiplier(
  plays: ArtistWeight[],
  ratings: Map<string, number>,
  ratingWeight: number
): ArtistWeight[] {
  return plays.map((play) => {
    const avg = ratings.get(play.name);
    if (avg === undefined) return play;
    return {
      name: play.name,
      viewCount: play.viewCount * (1 + ratingWeight * (avg / 10)),
    };
  });
}

/**
 * The recommender's canonical artist-weight source: windowed play trend from the user's
 * own plays series, boosted by their ratings. Reads everything from `user_signal_events`
 * — no live Plex query — except the cold-start case (zero captures in either series), where
 * one is ingested on demand so the first read still goes through our own table.
 */
export async function loadArtistWeights(
  userId: number,
  plexToken: string,
  windowMs: number,
  ratingWeight: number,
  now: number = Date.now()
): Promise<ArtistWeight[]> {
  let trackEvents = await getSignalEvents(userId, "plex_track_plays");
  const legacyEvents = await getSignalEvents(userId, "plex_plays");
  if (trackEvents.length === 0 && legacyEvents.length === 0) {
    await ingestUserTrackPlays(userId, plexToken);
    trackEvents = await getSignalEvents(userId, "plex_track_plays");
  }

  const plays = derivePlayWeights(trackEvents, legacyEvents, now, windowMs);
  const ratings = aggregateArtistRatings(
    await getSignalEvents(userId, "plex_rating")
  );
  return applyRatingMultiplier(plays, ratings, ratingWeight).filter(
    (weight) => !isPlaceholderArtist(weight.name)
  );
}
