import {
  historyCoverageStart,
  type ListenEpisode,
} from "../services/profile/listenHistory";
import {
  reconstructArtistTotals,
  toPlayEquivalents,
  type ArtistListenTotals,
} from "../services/profile/signalIngestion";
import { loadEpisodeSeries } from "../services/profile/listenSessions";
import { getSignalEvents } from "../db/userProfile";
import type { ArtistWeight } from "./artistWeights";
import type { UserSignalEvent } from "../db/entity/UserSignalEvent";
import type { ProfileArtistSeries } from "../db/entity/UserProfile";

/** One bucket's listening for one artist. `startMs` is the bucket's left edge, inclusive. */
export type SeriesBucket = {
  startMs: number;
  plays: number;
  listenedMs: number;
};

/**
 * One artist's listening over time, plus what the shape of it says. Buckets are dense and
 * chronological — a bucket the artist was not listened in is present and zero, because the
 * gaps are the signal.
 */
export type ArtistSeries = {
  name: string;
  buckets: SeriesBucket[];
  /**
   * Left edge of the first bucket carrying any listening, or null for an artist with none
   * in the span. Clipped by the span: an artist listened to before it starts reports the
   * first bucket, which is why {@link ArtistSeries.emerging} refuses to fire there.
   */
  firstSeenMs: number | null;
  /**
   * Recent average over the artist's own earlier average, in play-equivalents. `1` is
   * steady, `0` is gone quiet, and the ratio is against the artist itself so a small artist
   * doubling registers as strongly as a large one.
   */
  momentum: number;
  emerging: boolean;
  decaying: boolean;
};

export type ArtistSeriesOptions = {
  now: number;
  bucketMs: number;
  spanMs: number;
  recentBuckets: number;
  capMs: number;
  listeningWeight: number;
};

type BucketWindow = { startMs: number; endMs: number };

type SeriesTotals = { recentAvg: number; trailingAvg: number };

/**
 * Ceiling on the momentum ratio. An artist with no earlier listening at all divides by
 * zero, and the honest answer there is "as new as it gets" rather than infinity — which
 * would sort past every real ratio and serialize as `null`.
 */
export const MOMENTUM_MAX = 10;

/** Neutral momentum: no baseline to compare against, so the series claims nothing. */
const MOMENTUM_NEUTRAL = 1;

/**
 * Bucket edges covering `spanMs` back from `now`, aligned so the final bucket ends at `now`
 * rather than at a calendar boundary. Recency is what the series is read for, so the recent
 * end is the one kept whole.
 */
export function bucketWindows(
  now: number,
  spanMs: number,
  bucketMs: number
): BucketWindow[] {
  if (bucketMs <= 0 || spanMs <= 0) return [];
  const count = Math.max(1, Math.round(spanMs / bucketMs));
  const start = now - count * bucketMs;

  return Array.from({ length: count }, (_, i) => ({
    startMs: start + i * bucketMs,
    endMs: start + (i + 1) * bucketMs,
  }));
}

const emptyBuckets = (windows: BucketWindow[]): SeriesBucket[] =>
  windows.map((w) => ({ startMs: w.startMs, plays: 0, listenedMs: 0 }));

const creditedMs = (episode: ListenEpisode, capMs: number): number =>
  capMs > 0 ? Math.min(episode.listenedMs, capMs) : episode.listenedMs;

function ensureSeries(
  byArtist: Map<string, SeriesBucket[]>,
  name: string,
  windows: BucketWindow[]
): SeriesBucket[] {
  const existing = byArtist.get(name);
  if (existing) return existing;
  const created = emptyBuckets(windows);
  byArtist.set(name, created);
  return created;
}

/**
 * Episodes dropped into their buckets in one pass. Windowed on `startedAt` like every other
 * read of this series, so a long set lands in the bucket it was played in rather than the
 * one its play happened to commit in.
 */
export function bucketEpisodes(
  episodes: Map<string, ListenEpisode>,
  windows: BucketWindow[],
  capMs: number,
  fromIndex: number
): Map<string, SeriesBucket[]> {
  const byArtist = new Map<string, SeriesBucket[]>();
  if (windows.length === 0 || fromIndex >= windows.length) return byArtist;

  const origin = windows[0].startMs;
  const bucketMs = windows[0].endMs - windows[0].startMs;

  for (const episode of episodes.values()) {
    const index = Math.floor((episode.startedAt - origin) / bucketMs);
    if (index < fromIndex || index >= windows.length) continue;

    const name = episode.artistName || episode.artistKey;
    if (!name) continue;

    const bucket = ensureSeries(byArtist, name, windows)[index];
    bucket.plays += 1;
    bucket.listenedMs += creditedMs(episode, capMs);
  }
  return byArtist;
}

/**
 * Buckets the episode log does not reach, filled from the difference between two cumulative
 * snapshots. Totals are folded once per boundary and carried forward, so a span of N
 * uncovered buckets costs N folds rather than 2N.
 */
export function bucketCountDeltas(
  trackEvents: UserSignalEvent[],
  legacyEvents: UserSignalEvent[],
  windows: BucketWindow[],
  capMs: number,
  untilIndex: number
): Map<string, SeriesBucket[]> {
  const byArtist = new Map<string, SeriesBucket[]>();
  if (untilIndex <= 0) return byArtist;

  let before = reconstructArtistTotals(
    trackEvents,
    legacyEvents,
    windows[0].startMs,
    capMs
  );

  for (let index = 0; index < untilIndex; index += 1) {
    const after = reconstructArtistTotals(
      trackEvents,
      legacyEvents,
      windows[index].endMs,
      capMs
    );
    for (const [name, totals] of after) {
      const delta = deltaOf(totals, before.get(name));
      if (delta.plays === 0 && delta.listenedMs === 0) continue;
      const bucket = ensureSeries(byArtist, name, windows)[index];
      bucket.plays += delta.plays;
      bucket.listenedMs += delta.listenedMs;
    }
    before = after;
  }
  return byArtist;
}

function deltaOf(
  totals: ArtistListenTotals,
  before: ArtistListenTotals | undefined
): ArtistListenTotals {
  return {
    plays: Math.max(0, totals.plays - (before?.plays ?? 0)),
    listenedMs: Math.max(0, totals.listenedMs - (before?.listenedMs ?? 0)),
  };
}

/**
 * The first bucket the episode series is read for. Everything earlier comes from the count
 * deltas instead: both series describe the same plays, so a bucket taking from both would
 * count every play in it twice.
 *
 * The bucket coverage *begins inside* goes to the episodes, not the counts. It can undercount
 * by whatever happened in that bucket before the log starts, which is the smaller error: a
 * snapshot delta credits plays to the bucket it was captured in rather than the one they
 * happened in, so handing that bucket to the counts moves listening to the wrong week
 * instead of losing a little of it.
 */
export function coverageIndex(
  episodes: Map<string, ListenEpisode>,
  windows: BucketWindow[]
): number {
  const start = historyCoverageStart(episodes);
  if (start === null) return windows.length;

  const index = windows.findIndex((w) => w.endMs > start);
  return index === -1 ? windows.length : index;
}

function mergeSeries(
  target: Map<string, SeriesBucket[]>,
  source: Map<string, SeriesBucket[]>,
  windows: BucketWindow[]
): void {
  for (const [name, buckets] of source) {
    const into = ensureSeries(target, name, windows);
    for (const [index, bucket] of buckets.entries()) {
      into[index].plays += bucket.plays;
      into[index].listenedMs += bucket.listenedMs;
    }
  }
}

function averages(
  buckets: SeriesBucket[],
  recentBuckets: number,
  listeningWeight: number
): SeriesTotals {
  const split = Math.max(0, buckets.length - Math.max(1, recentBuckets));
  const weigh = (bucket: SeriesBucket): number =>
    toPlayEquivalents(bucket, listeningWeight);

  const trailing = buckets.slice(0, split);
  const recent = buckets.slice(split);
  const mean = (rows: SeriesBucket[]): number =>
    rows.length === 0
      ? 0
      : rows.reduce((sum, b) => sum + weigh(b), 0) / rows.length;

  return { recentAvg: mean(recent), trailingAvg: mean(trailing) };
}

function momentumOf(totals: SeriesTotals, hasTrailing: boolean): number {
  if (!hasTrailing) return MOMENTUM_NEUTRAL;
  if (totals.trailingAvg > 0) {
    return Math.min(MOMENTUM_MAX, totals.recentAvg / totals.trailingAvg);
  }
  return totals.recentAvg > 0 ? MOMENTUM_MAX : 0;
}

const hasListening = (bucket: SeriesBucket): boolean =>
  bucket.plays > 0 || bucket.listenedMs > 0;

/**
 * The first bucket any listening at all was recorded in. Buckets before it are empty because
 * nothing was being recorded yet, not because nothing was played, and averaging over them
 * drags every baseline to zero — which reads back as every artist having infinite momentum.
 * A span longer than the history it is drawn from is the normal case, not an edge one.
 */
export function dataStartIndex(series: Map<string, SeriesBucket[]>): number {
  let earliest = Infinity;
  for (const buckets of series.values()) {
    const index = buckets.findIndex(hasListening);
    if (index !== -1 && index < earliest) earliest = index;
  }
  return earliest === Infinity ? 0 : earliest;
}

function summarize(
  name: string,
  buckets: SeriesBucket[],
  dataStart: number,
  options: ArtistSeriesOptions
): ArtistSeries {
  const { recentBuckets, listeningWeight } = options;
  const measured = buckets.slice(dataStart);
  const firstActive = measured.findIndex(hasListening);
  const split = Math.max(0, measured.length - Math.max(1, recentBuckets));
  const totals = averages(measured, recentBuckets, listeningWeight);

  return {
    name,
    buckets,
    firstSeenMs: firstActive === -1 ? null : measured[firstActive].startMs,
    momentum: momentumOf(totals, split > 0),
    // The first measured bucket cannot tell a new artist from one already being listened to
    // when recording started, so it never counts as an emergence.
    emerging: firstActive > 0 && firstActive >= split,
    decaying: totals.recentAvg === 0 && totals.trailingAvg > 0,
  };
}

/**
 * Per-artist listening over time. Each bucket takes from exactly one series — episodes where
 * history reaches, cumulative count deltas before that — which is the same reconciliation
 * `derivePlayWeights` makes for its single window, applied per bucket.
 */
export function deriveArtistSeries(
  trackEvents: UserSignalEvent[],
  legacyEvents: UserSignalEvent[],
  episodes: Map<string, ListenEpisode>,
  options: ArtistSeriesOptions
): ArtistSeries[] {
  const windows = bucketWindows(options.now, options.spanMs, options.bucketMs);
  if (windows.length === 0) return [];

  const covered = coverageIndex(episodes, windows);
  const merged = bucketEpisodes(episodes, windows, options.capMs, covered);
  mergeSeries(
    merged,
    bucketCountDeltas(
      trackEvents,
      legacyEvents,
      windows,
      options.capMs,
      covered
    ),
    windows
  );

  const dataStart = dataStartIndex(merged);
  return Array.from(merged, ([name, buckets]) =>
    summarize(name, buckets, dataStart, options)
  );
}

/**
 * Copy the series signals onto the weights the recommender ranks by. Deliberately does not
 * touch `viewCount`: momentum is exposed for a picker to read, not folded into the ranking
 * behind one.
 */
export function attachSeriesSignals(
  weights: ArtistWeight[],
  series: ArtistSeries[]
): ArtistWeight[] {
  const byName = new Map(series.map((s) => [s.name, s]));

  return weights.map((weight) => {
    const found = byName.get(weight.name);
    if (!found) return weight;
    return {
      ...weight,
      momentum: found.momentum,
      emerging: found.emerging,
      decaying: found.decaying,
      firstSeenMs: found.firstSeenMs ?? undefined,
    };
  });
}

/** Flatten one derived series into the parallel-array shape the profile document stores. */
export function toProfileSeries(
  series: ArtistSeries,
  bucketMs: number
): ProfileArtistSeries {
  return {
    name: series.name,
    bucketMs,
    startMs: series.buckets[0]?.startMs ?? 0,
    plays: series.buckets.map((b) => b.plays),
    listenedMs: series.buckets.map((b) => b.listenedMs),
    firstSeenMs: series.firstSeenMs,
    momentum: series.momentum,
    emerging: series.emerging,
    decaying: series.decaying,
  };
}

/**
 * Which series are worth persisting. The ranked artists come first, then any emerging artist
 * they missed: an emergence is by definition an artist that has not accumulated enough
 * listening to rank yet, so keeping only the top N would drop exactly the ones the signal
 * exists to surface.
 */
export function selectProfileSeries(
  series: ArtistSeries[],
  ranked: string[],
  limit: number,
  bucketMs: number
): ProfileArtistSeries[] {
  const byName = new Map(series.map((s) => [s.name, s]));
  const chosen: ArtistSeries[] = [];
  const taken = new Set<string>();

  for (const name of ranked.slice(0, limit)) {
    const found = byName.get(name);
    if (!found) continue;
    chosen.push(found);
    taken.add(name);
  }

  const emerging = series
    .filter((s) => s.emerging && !taken.has(s.name))
    .sort((a, b) => b.momentum - a.momentum)
    .slice(0, limit);

  return [...chosen, ...emerging].map((s) => toProfileSeries(s, bucketMs));
}

/**
 * The series for one user, loaded and derived. Reads its own signals rather than sharing the
 * weighting's load: the two run on different cadences and coupling them would make the
 * cheaper one wait for the more expensive one.
 */
export async function loadArtistSeries(
  userId: number,
  options: ArtistSeriesOptions
): Promise<ArtistSeries[]> {
  return deriveArtistSeries(
    await getSignalEvents(userId, "plex_track_plays"),
    await getSignalEvents(userId, "plex_plays"),
    await loadEpisodeSeries(userId),
    options
  );
}
