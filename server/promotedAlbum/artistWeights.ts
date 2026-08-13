import { getSignalEvents } from "../db/userProfile";
import { isPlaceholderArtist } from "../utils/artistFilter";
import {
  ingestUserTrackPlays,
  latestRatings,
  reconstructPlayCounts,
  reconstructTrackPlayCounts,
  rollupToArtists,
} from "../services/profile/signalIngestion";
import type { ArtistPlayRollup } from "../services/profile/signalIngestion";
import type { UserSignalEvent } from "../db/entity/UserSignalEvent";

/**
 * An artist with the effective weight (windowed plays × rating boost × distribution factor)
 * the recommender ranks by. The distribution fields are absent for artists known only from
 * the legacy artist-level series, which carries no per-track detail.
 */
export type ArtistWeight = {
  name: string;
  viewCount: number;
  distinctTracksPlayed?: number;
  topTrackShare?: number;
  distributionFactor?: number;
};

/**
 * Play weights plus the window they were actually measured over: `windowStart` is null when
 * the series was too shallow (or the window empty) and the weights fell back to all-time.
 * Everything else derived per artist has to be measured over the same span to agree with them.
 */
export type PlayWeightResult = {
  weights: ArtistWeight[];
  windowStart: number | null;
};

/** Everything `loadArtistWeights` needs from `promotedAlbum` config, plus a clock override. */
export type ArtistWeightOptions = {
  windowMs: number;
  ratingWeight: number;
  distributionWeight: number;
  minPlaysForDistribution: number;
  now?: number;
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
): PlayWeightResult {
  const earliest = earliestRecordedAt(trackEvents, legacyEvents);
  if (earliest === null) return { weights: [], windowStart: null };
  const latest = reconstructArtistPlayCounts(
    trackEvents,
    legacyEvents,
    Infinity
  );

  const windowStart = now - windowMs;
  if (earliest > windowStart) {
    return { weights: allTimeWeights(latest), windowStart: null };
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
  return total > 0
    ? { weights: windowed, windowStart }
    : { weights: allTimeWeights(latest), windowStart: null };
}

/**
 * Per-artist play distribution over the window the weights were measured over, keyed by
 * artist name so it joins onto the weight set. `windowStart` comes straight from
 * {@link derivePlayWeights} rather than being re-derived here: deciding the span twice let
 * the weights be windowed while the distribution was all-time, so the discount was measured
 * over a different span than the weight it scales. Two artists sharing a name collapse to
 * whichever has more plays, mirroring how the counts merge.
 */
export function deriveArtistDistributions(
  trackEvents: UserSignalEvent[],
  windowStart: number | null
): Map<string, ArtistPlayRollup> {
  const latest = reconstructTrackPlayCounts(trackEvents, Infinity);

  const rollups =
    windowStart === null
      ? rollupToArtists(latest)
      : rollupToArtists(
          latest,
          reconstructTrackPlayCounts(trackEvents, windowStart)
        );

  const byName = new Map<string, ArtistPlayRollup>();
  for (const rollup of rollups) {
    if (!rollup.name) continue;
    const existing = byName.get(rollup.name);
    if (!existing || rollup.playCount > existing.playCount) {
      byName.set(rollup.name, rollup);
    }
  }
  return byName;
}

/**
 * Scale each artist's weight by how broadly their plays spread across their tracks:
 * `factor = 1 - distributionWeight × topTrackShare`, where `topTrackShare` is the share of
 * the artist's plays belonging to their single most-played track. One song on repeat is a
 * song the user likes; the same play count spread over a catalogue is an artist they like,
 * and only the second should pull that artist's whole tag set into the genre vector.
 *
 * `distributionWeight` of `0` is a no-op, so the correction is switchable from settings.
 * Artists below `minPlays` are left alone — at a handful of plays `topTrackShare` is noise,
 * not concentration — as are artists with no track-level data at all.
 */
export function applyDistributionFactor(
  plays: ArtistWeight[],
  distributions: Map<string, ArtistPlayRollup>,
  distributionWeight: number,
  minPlays: number
): ArtistWeight[] {
  if (distributionWeight === 0) return plays;

  return plays.map((play) => {
    const dist = distributions.get(play.name);
    if (!dist || dist.playCount < minPlays || dist.playCount <= 0) return play;

    const topTrackShare = dist.topTrackPlayCount / dist.playCount;
    const distributionFactor = 1 - distributionWeight * topTrackShare;
    return {
      name: play.name,
      viewCount: play.viewCount * distributionFactor,
      distinctTracksPlayed: dist.distinctTracksPlayed,
      topTrackShare,
      distributionFactor,
    };
  });
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
      ...play,
      viewCount: play.viewCount * (1 + ratingWeight * (avg / 10)),
    };
  });
}

/**
 * The recommender's canonical artist-weight source: windowed play trend from the user's own
 * plays series, boosted by their ratings and scaled by how broadly each artist's plays
 * spread across their tracks. Reads everything from `user_signal_events` — no live Plex
 * query — except the cold-start case (zero captures in either series), where one is ingested
 * on demand so the first read still goes through our own table.
 */
export async function loadArtistWeights(
  userId: number,
  plexToken: string,
  options: ArtistWeightOptions
): Promise<ArtistWeight[]> {
  const {
    windowMs,
    ratingWeight,
    distributionWeight,
    minPlaysForDistribution,
  } = options;
  const now = options.now ?? Date.now();

  let trackEvents = await getSignalEvents(userId, "plex_track_plays");
  const legacyEvents = await getSignalEvents(userId, "plex_plays");
  if (trackEvents.length === 0 && legacyEvents.length === 0) {
    await ingestUserTrackPlays(userId, plexToken);
    trackEvents = await getSignalEvents(userId, "plex_track_plays");
  }

  const plays = derivePlayWeights(trackEvents, legacyEvents, now, windowMs);
  const spread = applyDistributionFactor(
    plays.weights,
    deriveArtistDistributions(trackEvents, plays.windowStart),
    distributionWeight,
    minPlaysForDistribution
  );
  const ratings = aggregateArtistRatings(
    await getSignalEvents(userId, "plex_rating")
  );
  return applyRatingMultiplier(spread, ratings, ratingWeight).filter(
    (weight) => !isPlaceholderArtist(weight.name)
  );
}
