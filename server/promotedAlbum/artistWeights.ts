import { getSignalEvents } from "../db/userProfile";
import { isPlaceholderArtist } from "../utils/artistFilter";
import {
  ingestUserTrackPlays,
  latestRatings,
  reconstructTrackPlayCounts,
  reconstructArtistTotals,
  rollupToAlbums,
  toPlayEquivalents,
} from "../services/profile/signalIngestion";
import type {
  AlbumPlayRollup,
  ArtistListenTotals,
  PlexRatingPayload,
  TrackPlayState,
} from "../services/profile/signalIngestion";

import {
  historyCovers,
  rollupEpisodesToAlbums,
  rollupEpisodesToArtists,
} from "../services/profile/listenHistory";
import { loadEpisodeSeries } from "../services/profile/listenSessions";
import type { ListenEpisode } from "../services/profile/listenHistory";
import type { UserSignalEvent } from "../db/entity/UserSignalEvent";

/** Re-exported so consumers of the weighting keep one import for the fold primitives too. */
export {
  reconstructArtistTotals,
  toPlayEquivalents,
} from "../services/profile/signalIngestion";
export type { ArtistListenTotals } from "../services/profile/signalIngestion";

/**
 * An artist with the effective weight (windowed listening × rating boost × distribution
 * factor) the recommender ranks by. The distribution fields are absent for artists the
 * windowed track fold holds no rows for, which happens when the weights were measured from
 * the episode series; the rating fields are absent for artists with nothing rated.
 *
 * `viewCount` is denominated in **play-equivalents**, not plays: one play of a nominal-length
 * track is `1`, one play of a 90-minute set is ~26. The name predates listening time and is
 * kept because it is what every consumer reads. See {@link toPlayEquivalents}.
 */
export type ArtistWeight = {
  name: string;
  viewCount: number;
  distinctTracksPlayed?: number;
  topTrackShare?: number;
  distributionFactor?: number;
  ratingBreadth?: number;
  ratingMultiplier?: number;
  /** Tracks the library holds by this artist; absent until a catalogue capture has run. */
  availableTracks?: number;
  /**
   * Shape-of-listening signals from {@link deriveArtistSeries}, absent when no series was
   * derived. They describe how the listening arrived over time; `viewCount` describes how
   * much of it there was, and nothing here is folded into it.
   */
  momentum?: number;
  emerging?: boolean;
  decaying?: boolean;
  firstSeenMs?: number;
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
};

/** One album's plays over the measured window, for joining an album rating onto tracks. */
type AlbumPlays = { artist: string; plays: number; trackKeys: Set<string> };

/** A rating resolved to the artist and the plays it speaks for. */
type JoinedRating = {
  artist: string;
  rating: number;
  plays: number;
};

type RatingTotals = { weighted: number; weight: number };

/**
 * Play weights plus the window they were actually measured over: `windowStart` is null when
 * the series was too shallow (or the window empty) and the weights fell back to all-time.
 * Everything else derived per artist has to be measured over the same span to agree with them.
 */
export type PlayWeightResult = {
  weights: ArtistWeight[];
  windowStart: number | null;
};

/** Every raw signal series one load pulls, so several derivations can share the fold. */
export type SignalBundle = {
  trackEvents: UserSignalEvent[];
  ratingEvents: UserSignalEvent[];
  albumEvents: UserSignalEvent[];
  episodes: Map<string, ListenEpisode>;
};

/** Everything `loadArtistWeights` needs from `promotedAlbum` config, plus a clock override. */
export type ArtistWeightOptions = {
  windowMs: number;
  ratingWeight: number;
  listeningWeight: number;
  maxTrackMinutesForWeight: number;
  now?: number;
};

/** What {@link derivePlayWeights} needs beyond the series themselves. */
export type PlayWeightOptions = {
  now: number;
  windowMs: number;
  /** Per-play ceiling on listening credit, in ms; `0` is uncapped. */
  capMs: number;
  /** `0` ranks on plays, `1` on listening time. See {@link toPlayEquivalents}. */
  listeningWeight: number;
};

function allTimeWeights(
  latest: Map<string, ArtistListenTotals>,
  listeningWeight: number
): ArtistWeight[] {
  return Array.from(latest, ([name, totals]) => ({
    name,
    viewCount: toPlayEquivalents(totals, listeningWeight),
  }));
}

/** `recorded_at` of the oldest event in the series, or null when it has none. */
function earliestRecordedAt(events: UserSignalEvent[]): number | null {
  const first = events[0];
  return first === undefined ? null : Date.parse(first.recorded_at);
}

/**
 * Per-artist totals for the window, taken from the episode series when it covers the window
 * outright. History records which plays happened and when, so where it reaches it is the
 * better answer than a difference of two cumulative snapshots — and once a session
 * observation has replaced an episode's inferred time, this is also how measured listening
 * reaches the weights. Returns null when history does not cover the window, which is the
 * signal to fall back to the count deltas rather than to add both and count every play twice.
 */
function episodeTotals(
  episodes: Map<string, ListenEpisode>,
  windowStart: number,
  now: number,
  capMs: number
): Map<string, ArtistListenTotals> | null {
  if (!historyCovers(episodes, windowStart)) return null;

  const totals = new Map<string, ArtistListenTotals>();
  for (const rollup of rollupEpisodesToArtists(
    episodes,
    windowStart,
    now,
    capMs
  )) {
    if (!rollup.name) continue;
    const known = totals.get(rollup.name);
    // Two artists sharing a name collapse to the busier, mirroring how the counts merge.
    if (known && known.listenedMs >= rollup.listenedMs) continue;
    totals.set(rollup.name, {
      plays: rollup.plays,
      listenedMs: rollup.listenedMs,
    });
  }
  return totals;
}

/** The window's totals per artist, as the difference between two cumulative snapshots. */
function countDeltaTotals(
  trackEvents: UserSignalEvent[],
  windowStart: number,
  latest: Map<string, ArtistListenTotals>,
  capMs: number
): Map<string, ArtistListenTotals> {
  const baseline = reconstructArtistTotals(trackEvents, windowStart, capMs);

  const deltas = new Map<string, ArtistListenTotals>();
  for (const [name, totals] of latest) {
    const before = baseline.get(name);
    deltas.set(name, {
      plays: Math.max(0, totals.plays - (before?.plays ?? 0)),
      listenedMs: Math.max(0, totals.listenedMs - (before?.listenedMs ?? 0)),
    });
  }
  return deltas;
}

/**
 * Per-artist weight over the recent window, in play-equivalents. The window's listening
 * comes from the episode series where history covers it, and from the difference of two
 * cumulative snapshots otherwise — one or the other, never both, or every play inside the
 * covered span would count twice.
 *
 * Until either series is deep enough to span the window — or when nothing was played in it —
 * weight falls back to the latest cumulative all-time totals, so the set is never empty and
 * a thin history still produces sensible weights.
 */
export function derivePlayWeights(
  trackEvents: UserSignalEvent[],
  episodes: Map<string, ListenEpisode>,
  options: PlayWeightOptions
): PlayWeightResult {
  const { now, windowMs, capMs, listeningWeight } = options;
  const earliest = earliestRecordedAt(trackEvents);
  if (earliest === null) return { weights: [], windowStart: null };

  const latest = reconstructArtistTotals(trackEvents, Infinity, capMs);
  const windowStart = now - windowMs;
  const allTime = {
    weights: allTimeWeights(latest, listeningWeight),
    windowStart: null,
  };

  const covered = episodeTotals(episodes, windowStart, now, capMs);
  if (!covered && earliest > windowStart) return allTime;

  const deltas =
    covered ?? countDeltaTotals(trackEvents, windowStart, latest, capMs);

  const windowed: ArtistWeight[] = [];
  let total = 0;
  for (const [name, totals] of deltas) {
    const viewCount = toPlayEquivalents(totals, listeningWeight);
    total += viewCount;
    if (viewCount > 0) windowed.push({ name, viewCount });
  }
  return total > 0 ? { weights: windowed, windowStart } : allTime;
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
 * Per-album plays and listening over the same window the artist weights were measured over,
 * from the same source those weights came from — episodes where history covers the window,
 * the difference of two cumulative snapshots otherwise. `derivePlayWeights` is re-run rather
 * than threaded through so both derivations settle the window from identical inputs by one
 * rule: an album's share of its artist has to be measured over the span that artist's weight
 * was measured over, or splitting the weight silently re-weights the artist instead.
 */
export function deriveAlbumWeights(
  bundle: SignalBundle,
  options: ArtistWeightOptions
): AlbumPlayRollup[] {
  const now = options.now ?? Date.now();
  const capMs = Math.max(0, options.maxTrackMinutesForWeight) * 60_000;
  const { trackEvents, episodes } = bundle;

  const { windowStart } = derivePlayWeights(trackEvents, episodes, {
    now,
    windowMs: options.windowMs,
    capMs,
    listeningWeight: options.listeningWeight,
  });

  if (windowStart !== null && historyCovers(episodes, windowStart)) {
    return rollupEpisodesToAlbums(episodes, windowStart, now, capMs);
  }
  return rollupToAlbums(
    deriveWindowedTrackPlays(trackEvents, windowStart),
    capMs
  );
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
  albums: Map<string, AlbumPlays>
): JoinedRating | null {
  if (payload.rating <= 0) return null;

  if (payload.kind === "track") {
    const track = tracks.get(payload.ratingKey);
    const artist = track?.artistName || payload.artist;
    if (!artist) return null;

    return { artist, rating: payload.rating, plays: track?.playCount ?? 0 };
  }

  const album = albums.get(payload.ratingKey);
  const artist = album?.artist || payload.artist;
  if (!artist) return null;
  return { artist, rating: payload.rating, plays: album?.plays ?? 0 };
}

/**
 * Per-artist rating signal joined onto the play series, from the latest rating known for
 * each rated item. Items whose latest rating is `0` (un-rated) are excluded so a cleared
 * star doesn't drag an artist's mean down.
 *
 * The mean is play-weighted: each rated item counts for `1 + plays`, so a star on the track
 * carrying an artist's listening outweighs one on a deep cut, while an unplayed rated item
 * still counts once — rating something is a deliberate act even when it is never played.
 */
export function aggregateArtistRatings(
  ratingEvents: UserSignalEvent[],
  tracks: Map<string, TrackPlayState>
): Map<string, ArtistRatingSignal> {
  const albums = indexAlbumPlays(tracks);
  const totals = new Map<string, RatingTotals>();

  for (const payload of latestRatings(ratingEvents).values()) {
    const joined = joinRating(payload, tracks, albums);
    if (!joined) continue;

    const weight = 1 + joined.plays;
    const entry = totals.get(joined.artist) ?? { weighted: 0, weight: 0 };
    entry.weighted += joined.rating * weight;
    entry.weight += weight;
    totals.set(joined.artist, entry);
  }

  const signals = new Map<string, ArtistRatingSignal>();
  for (const [name, { weighted, weight }] of totals) {
    signals.set(name, { rating: weighted / weight });
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
/**
 * Every signal series a weighting reads, loaded once. Exposed so a caller needing more than
 * one derivation off the same signals — weights *and* the listening series — folds the log
 * once instead of per derivation.
 */
export async function loadSignalBundle(
  userId: number,
  plexToken: string
): Promise<SignalBundle> {
  let trackEvents = await getSignalEvents(userId, "plex_track_plays");
  if (trackEvents.length === 0) {
    await ingestUserTrackPlays(userId, plexToken);
    trackEvents = await getSignalEvents(userId, "plex_track_plays");
  }

  return {
    trackEvents,
    ratingEvents: await getSignalEvents(userId, "plex_rating"),
    albumEvents: await getSignalEvents(userId, "plex_album_tracks"),
    episodes: await loadEpisodeSeries(userId),
  };
}

export function deriveArtistWeights(
  bundle: SignalBundle,
  options: ArtistWeightOptions
): ArtistWeight[] {
  const { windowMs, ratingWeight, listeningWeight, maxTrackMinutesForWeight } =
    options;
  const now = options.now ?? Date.now();
  const capMs = Math.max(0, maxTrackMinutesForWeight) * 60_000;
  const { trackEvents, ratingEvents, episodes } = bundle;

  const plays = derivePlayWeights(trackEvents, episodes, {
    now,
    windowMs,
    capMs,
    listeningWeight,
  });
  const trackPlays = deriveWindowedTrackPlays(trackEvents, plays.windowStart);
  const ratings = aggregateArtistRatings(ratingEvents, trackPlays);

  return applyRatingMultiplier(plays.weights, ratings, ratingWeight).filter(
    (weight) => !isPlaceholderArtist(weight.name)
  );
}

export async function loadArtistWeights(
  userId: number,
  plexToken: string,
  options: ArtistWeightOptions
): Promise<ArtistWeight[]> {
  return deriveArtistWeights(
    await loadSignalBundle(userId, plexToken),
    options
  );
}
