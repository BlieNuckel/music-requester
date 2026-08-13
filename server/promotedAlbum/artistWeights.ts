import { getSignalEvents } from "../db/userProfile";
import { isPlaceholderArtist } from "../utils/artistFilter";
import {
  ingestUserTrackPlays,
  latestRatings,
  reconstructPlayCounts,
  reconstructTrackPlayCounts,
  rollupToArtists,
} from "../services/profile/signalIngestion";
import type {
  ArtistPlayRollup,
  PlexRatingPayload,
  TrackPlayState,
} from "../services/profile/signalIngestion";
import type { UserSignalEvent } from "../db/entity/UserSignalEvent";

/**
 * An artist with the effective weight (windowed plays × rating boost × distribution factor)
 * the recommender ranks by. The distribution fields are absent for artists known only from
 * the legacy artist-level series, which carries no per-track detail; the rating fields are
 * absent for artists with nothing rated.
 */
export type ArtistWeight = {
  name: string;
  viewCount: number;
  distinctTracksPlayed?: number;
  topTrackShare?: number;
  distributionFactor?: number;
  ratingBreadth?: number;
  ratingMultiplier?: number;
};

/**
 * What the rating series says about one artist, joined onto the plays those ratings
 * actually cover.
 *
 * `rating` is a play-weighted mean on Plex's 0–10 scale: each rated item counts for
 * `1 + plays`, so a star on the track carrying the artist's listening outweighs one on a
 * deep cut, while an unplayed rated item still counts once — a rating is a deliberate act,
 * not a by-product of listening.
 *
 * `breadth` is the share of that rated weight sitting anywhere other than the artist's
 * single most-played track, which is the evidence {@link applyDistributionFactor} needs to
 * stop arguing with the boost: starring the one hit *confirms* the one-hit read (breadth 0),
 * starring the rest of the catalogue refutes it (breadth → 1).
 */
export type ArtistRatingSignal = {
  rating: number;
  breadth: number;
};

/** One album's plays over the measured window, for joining an album rating onto tracks. */
type AlbumPlays = { artist: string; plays: number; trackKeys: Set<string> };

/** A rating resolved to the artist and the plays it speaks for. */
type JoinedRating = {
  artist: string;
  rating: number;
  plays: number;
  /** The part of `plays` belonging to the artist's most-played track. */
  topTrackPlays: number;
};

type RatingTotals = { weighted: number; weight: number; offTopWeight: number };

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
 * Per-track plays over the window the weights were measured over: the current fold with each
 * `playCount` replaced by its increase since `windowStart` (the plain cumulative count when
 * the weights fell back to all-time). `windowStart` comes straight from
 * {@link derivePlayWeights} rather than being re-derived here: deciding the span twice let
 * the weights be windowed while the distribution was all-time, so the discount was measured
 * over a different span than the weight it scales. Everything downstream reads this one map,
 * so the distribution factor and the rating join necessarily describe the same window.
 */
export function deriveWindowedTrackPlays(
  trackEvents: UserSignalEvent[],
  windowStart: number | null
): Map<string, TrackPlayState> {
  const latest = reconstructTrackPlayCounts(trackEvents, Infinity);
  if (windowStart === null) return latest;

  const baseline = reconstructTrackPlayCounts(trackEvents, windowStart);
  const windowed = new Map<string, TrackPlayState>();
  for (const [key, track] of latest) {
    windowed.set(key, {
      ...track,
      playCount: Math.max(
        0,
        track.playCount - (baseline.get(key)?.playCount ?? 0)
      ),
    });
  }
  return windowed;
}

/**
 * Per-artist play distribution over the measured window, keyed by artist name so it joins
 * onto the weight set. Two artists sharing a name collapse to whichever has more plays,
 * mirroring how the counts merge.
 */
export function deriveArtistDistributions(
  tracks: Map<string, TrackPlayState>
): Map<string, ArtistPlayRollup> {
  const rollups = rollupToArtists(tracks);

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
 * The discount is refuted by the artist's rating breadth: ratings spread across the
 * catalogue are direct evidence against the one-hit read, so they scale the discount down
 * (`× (1 - breadth)`), while a rating on the concentrated track leaves it at full strength.
 * Without that term the two multipliers model the same question and pull the same direction
 * whichever track is starred.
 *
 * `distributionWeight` of `0` is a no-op, so the correction is switchable from settings.
 * Artists below `minPlays` are left alone — at a handful of plays `topTrackShare` is noise,
 * not concentration — as are artists with no track-level data at all.
 */
export function applyDistributionFactor(
  plays: ArtistWeight[],
  distributions: Map<string, ArtistPlayRollup>,
  ratings: Map<string, ArtistRatingSignal>,
  distributionWeight: number,
  minPlays: number
): ArtistWeight[] {
  if (distributionWeight === 0) return plays;

  return plays.map((play) => {
    const dist = distributions.get(play.name);
    if (!dist || dist.playCount < minPlays || dist.playCount <= 0) return play;

    const signal = ratings.get(play.name);
    const topTrackShare = dist.topTrackPlayCount / dist.playCount;
    const distributionFactor =
      1 - distributionWeight * topTrackShare * (1 - (signal?.breadth ?? 0));
    return {
      name: play.name,
      viewCount: play.viewCount * distributionFactor,
      distinctTracksPlayed: dist.distinctTracksPlayed,
      topTrackShare,
      distributionFactor,
      ...(signal ? { ratingBreadth: signal.breadth } : {}),
    };
  });
}

/** Album `ratingKey` → the plays its tracks hold, so an album rating joins onto listening. */
function indexAlbumPlays(
  tracks: Map<string, TrackPlayState>
): Map<string, AlbumPlays> {
  const albums = new Map<string, AlbumPlays>();
  for (const track of tracks.values()) {
    if (!track.albumKey) continue;

    const existing = albums.get(track.albumKey);
    if (!existing) {
      albums.set(track.albumKey, {
        artist: track.artistName,
        plays: track.playCount,
        trackKeys: new Set([track.ratingKey]),
      });
      continue;
    }
    existing.plays += track.playCount;
    existing.trackKeys.add(track.ratingKey);
    if (!existing.artist) existing.artist = track.artistName;
  }
  return albums;
}

/**
 * Resolve one rating to the artist and the plays it describes. Track ratings join on their
 * own `ratingKey`, album ratings on the album rollup of the same fold — both exact. A rated
 * item absent from the fold (never played, or not played inside the window) still counts,
 * falling back to the artist name the payload carries.
 */
function joinRating(
  payload: PlexRatingPayload,
  tracks: Map<string, TrackPlayState>,
  albums: Map<string, AlbumPlays>,
  distributions: Map<string, ArtistPlayRollup>
): JoinedRating | null {
  if (payload.rating <= 0) return null;

  if (payload.kind === "track") {
    const track = tracks.get(payload.ratingKey);
    const artist = track?.artistName || payload.artist;
    if (!artist) return null;

    const plays = track?.playCount ?? 0;
    const isTopTrack =
      track !== undefined &&
      distributions.get(artist)?.topTrackKey === track.ratingKey;
    return {
      artist,
      rating: payload.rating,
      plays,
      topTrackPlays: isTopTrack ? plays : 0,
    };
  }

  const album = albums.get(payload.ratingKey);
  const artist = album?.artist || payload.artist;
  if (!artist) return null;
  if (!album) {
    return { artist, rating: payload.rating, plays: 0, topTrackPlays: 0 };
  }

  const topTrackKey = distributions.get(artist)?.topTrackKey;
  const topTrackPlays =
    topTrackKey && album.trackKeys.has(topTrackKey)
      ? (tracks.get(topTrackKey)?.playCount ?? 0)
      : 0;
  return {
    artist,
    rating: payload.rating,
    plays: album.plays,
    topTrackPlays,
  };
}

/**
 * Per-artist rating signal joined onto the play series, from the latest rating known for
 * each rated item. Items whose latest rating is `0` (un-rated) are excluded so a cleared
 * star doesn't drag an artist's mean down. See {@link ArtistRatingSignal} for what the two
 * numbers mean and how the weighting is chosen.
 */
export function aggregateArtistRatings(
  ratingEvents: UserSignalEvent[],
  tracks: Map<string, TrackPlayState>,
  distributions: Map<string, ArtistPlayRollup>
): Map<string, ArtistRatingSignal> {
  const albums = indexAlbumPlays(tracks);
  const totals = new Map<string, RatingTotals>();

  for (const payload of latestRatings(ratingEvents).values()) {
    const joined = joinRating(payload, tracks, albums, distributions);
    if (!joined) continue;

    const weight = 1 + joined.plays;
    const offTopShare =
      joined.plays > 0 ? 1 - joined.topTrackPlays / joined.plays : 1;
    const entry = totals.get(joined.artist) ?? {
      weighted: 0,
      weight: 0,
      offTopWeight: 0,
    };
    entry.weighted += joined.rating * weight;
    entry.weight += weight;
    entry.offTopWeight += weight * offTopShare;
    totals.set(joined.artist, entry);
  }

  const signals = new Map<string, ArtistRatingSignal>();
  for (const [name, { weighted, weight, offTopWeight }] of totals) {
    signals.set(name, {
      rating: weighted / weight,
      breadth: offTopWeight / weight,
    });
  }
  return signals;
}

/** Boost each artist's play weight by its rating: `× (1 + ratingWeight × rating/10)`. */
export function applyRatingMultiplier(
  plays: ArtistWeight[],
  ratings: Map<string, ArtistRatingSignal>,
  ratingWeight: number
): ArtistWeight[] {
  return plays.map((play) => {
    const signal = ratings.get(play.name);
    if (!signal) return play;

    const ratingMultiplier = 1 + ratingWeight * (signal.rating / 10);
    return {
      ...play,
      viewCount: play.viewCount * ratingMultiplier,
      ratingMultiplier,
    };
  });
}

/**
 * The recommender's canonical artist-weight source: windowed play trend from the user's own
 * plays series, scaled by how broadly each artist's plays spread across their tracks and
 * boosted by their ratings joined onto the very tracks those ratings cover — which is also
 * what lets the two corrections agree rather than double-count. Reads everything from
 * `user_signal_events` — no live Plex
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
  const trackPlays = deriveWindowedTrackPlays(trackEvents, plays.windowStart);
  const distributions = deriveArtistDistributions(trackPlays);
  const ratings = aggregateArtistRatings(
    await getSignalEvents(userId, "plex_rating"),
    trackPlays,
    distributions
  );

  const spread = applyDistributionFactor(
    plays.weights,
    distributions,
    ratings,
    distributionWeight,
    minPlaysForDistribution
  );
  return applyRatingMultiplier(spread, ratings, ratingWeight).filter(
    (weight) => !isPlaceholderArtist(weight.name)
  );
}
