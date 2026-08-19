import { getRatedItems, getItemRating } from "../../api/plex/ratings";
import {
  getAllAlbumTrackCounts,
  type AlbumTrackCount,
} from "../../api/plex/albumTrackCounts";
import {
  getAllTrackPlayCounts,
  type TrackPlayCount,
} from "../../api/plex/trackPlayCounts";
import { appendSignalEvents, getSignalEvents } from "../../db/userProfile";
import { createLogger } from "../../logger";
import type { UserSignalEvent } from "../../db/entity/UserSignalEvent";
import type { PlexRatedItem } from "../../api/plex/types";

/** Payload of a `kind = "plex_rating"` event — maps 1:1 to a `PlexRatedItem`. */
export type PlexRatingPayload = {
  ratingKey: string;
  kind: PlexRatedItem["kind"];
  title: string;
  artist: string;
  /**
   * Parent keys, so a rating joins onto the play series by key rather than by artist name.
   * Absent on events written before the fields existed, and on album ratings for `albumKey`
   * (the rating's own `ratingKey` is the album); those fall back to the name join.
   */
  albumKey?: string;
  artistKey?: string;
  /** Plex scale 0–10; `0` is the sentinel for an un-rated (un-starred) item. */
  rating: number;
};

/**
 * Payload of a `kind = "plex_plays"` event — the legacy artist-level plays series,
 * superseded by `plex_track_plays`. Still read (it is the only record of pre-cutover
 * history) but no longer written. Each event is a delta: only the artists whose
 * cumulative play count *increased* since the previous capture. Reconstruct a full
 * state by folding the series (see {@link reconstructPlayCounts}).
 */
export type PlexPlaysPayload = {
  artists: { name: string; playCount: number }[];
};

/** One track's cumulative play count plus the album/artist it rolls up into. */
export type TrackPlayState = {
  ratingKey: string;
  title: string;
  artistKey: string;
  artistName: string;
  albumKey: string;
  albumTitle: string;
  playCount: number;
  /**
   * Track length in milliseconds. Absent on events written before the field existed, and `0`
   * where Plex reports no length; both fold to {@link NOMINAL_TRACK_MS} until
   * {@link ingestUserTrackPlays} backfills them.
   */
  durationMs?: number;
};

/**
 * Payload of a `kind = "plex_track_plays"` event. Each event is a delta: only the tracks
 * whose cumulative play count *increased* since the previous capture. Fold the series with
 * {@link reconstructTrackPlayCounts}, then accumulate to artists or albums.
 */
export type PlexTrackPlaysPayload = {
  tracks: TrackPlayState[];
};

export type ArtistPlayRollup = {
  artistKey: string;
  name: string;
  playCount: number;
  /**
   * Time spent on this artist in milliseconds, **inferred** as plays x track length rather
   * than observed. Sound as an exposure estimate because Plex only commits a play once
   * playback passes half the track, so it over-credits by a length-independent factor that
   * cancels in relative weighting.
   */
  listenedMs: number;
  distinctTracksPlayed: number;
  topTrackPlayCount: number;
  /**
   * Inferred time on the artist's most-*listened* track, which is not necessarily
   * {@link topTrackKey} — that stays keyed on plays.
   */
  topTrackListenedMs: number;
  /** `ratingKey` of the most-played track, so a rating can be tested against it. */
  topTrackKey: string;
};

export type AlbumPlayRollup = {
  albumKey: string;
  title: string;
  artistName: string;
  playCount: number;
};

/** One album's track count — how much of it exists, regardless of what was played. */
export type AlbumTrackState = {
  ratingKey: string;
  title: string;
  artistKey: string;
  artistName: string;
  trackCount: number;
};

/**
 * Payload of a `kind = "plex_album_tracks"` event. Each event is a delta: only the albums
 * whose track count differs from the last capture. Fold the series with
 * {@link reconstructAlbumTrackCounts}, then accumulate with {@link rollupToArtistCatalogue}.
 */
export type PlexAlbumTracksPayload = {
  albums: AlbumTrackState[];
};

const log = createLogger("signal-ingestion");

/**
 * Cap on tracks per event. Steady-state captures are a handful of tracks, but the first
 * capture is every played track in the library — one event would be a multi-megabyte
 * `payload` cell. Chunks are appended in order and the fold is last-write-wins, so N
 * ordered chunks reconstruct identically to one oversized event.
 */
const MAX_TRACKS_PER_EVENT = 2000;

/**
 * Length assumed for a track with no duration on its event — pre-backfill rows, and the
 * handful Plex genuinely reports nothing for. Roughly a pop single, so such a track keeps
 * about the weight it had when plays were the only currency.
 */
export const NOMINAL_TRACK_MS = 210_000;

/**
 * Upper bound on per-sweep un-rating candidates. Beyond this, a mass disappearance is
 * far more likely a Plex data event (history clear, library re-import) than a user
 * deliberately un-starring; we skip rather than corrupt the backup with bogus clears.
 */
const UNRATE_CANDIDATE_CAP = 50;

/** Parallel per-item Plex reads while confirming un-ratings. */
const UNRATE_CONFIRM_CONCURRENCY = 5;

/**
 * Fold an append-only event series into keyed state, last-write-wins.
 *
 * REQUIRES the series in the order it was written, oldest first — which is what
 * `getSignalEvents` returns (`ORDER BY recorded_at, id`). Order carries two meanings
 * here: a later event overwrites an earlier one for the same key, and the scan stops
 * at the first event past `cutoffMs`. Hand this an unordered series and it silently
 * returns wrong state rather than failing, so don't.
 *
 * A payload that won't parse is skipped and counted; a systematically malformed write
 * would otherwise degrade profiles with nothing in the logs to explain it.
 */
export function foldEvents<TPayload, TValue>(
  events: UserSignalEvent[],
  cutoffMs: number,
  entries: (payload: TPayload) => Iterable<[string, TValue]>,
  label: string
): Map<string, TValue> {
  const state = new Map<string, TValue>();
  let unparsed = 0;

  for (const event of events) {
    if (Date.parse(event.recorded_at) > cutoffMs) break;
    let payload: TPayload;
    try {
      payload = JSON.parse(event.payload) as TPayload;
    } catch {
      unparsed += 1;
      continue;
    }
    if (!payload) continue;
    for (const [key, value] of entries(payload)) {
      state.set(key, value);
    }
  }

  if (unparsed > 0) {
    log.warn(`Skipped ${unparsed} unparsable ${label} event(s)`);
  }
  return state;
}

/**
 * Latest known rating per `ratingKey`, replayed from the append-only `plex_rating`
 * log. Events arrive oldest-first, so a later write overwrites an earlier one.
 */
export function latestRatings(
  events: UserSignalEvent[]
): Map<string, PlexRatingPayload> {
  return foldEvents<PlexRatingPayload, PlexRatingPayload>(
    events,
    Infinity,
    (payload) =>
      typeof payload.ratingKey === "string"
        ? [[payload.ratingKey, payload]]
        : [],
    "plex_rating"
  );
}

/**
 * Whether a stored payload predates the parent-key fields while the live item carries
 * them. The rating itself is unchanged, so nothing else would ever rewrite the event —
 * and until one is written the rating can only join onto the plays series by name.
 */
function needsKeyBackfill(
  prior: PlexRatingPayload,
  item: PlexRatedItem
): boolean {
  return (
    (item.artistKey !== undefined && prior.artistKey === undefined) ||
    (item.albumKey !== undefined && prior.albumKey === undefined)
  );
}

/**
 * Change events for the current rated set vs. the latest known ratings: a row for
 * each new or changed rating, plus a one-time rewrite of events stored without the
 * parent keys. Items dropping out of the rated set (un-ratings) are handled separately
 * by {@link detectUnratings} + {@link recordUnratings}, which confirm each disappearance
 * against live Plex before recording a clear — so a transient empty/filtered response
 * can't emit mass bogus clears.
 */
export function diffRatings(
  previous: Map<string, PlexRatingPayload>,
  current: PlexRatedItem[]
): PlexRatingPayload[] {
  const changes: PlexRatingPayload[] = [];
  for (const item of current) {
    const prior = previous.get(item.ratingKey);
    if (
      !prior ||
      prior.rating !== item.rating ||
      needsKeyBackfill(prior, item)
    ) {
      changes.push({
        ratingKey: item.ratingKey,
        kind: item.kind,
        title: item.title,
        artist: item.artist,
        albumKey: item.albumKey,
        artistKey: item.artistKey,
        rating: item.rating,
      });
    }
  }
  return changes;
}

/**
 * Rated items that have disappeared from the current set: keys we last knew as rated
 * (`rating > 0`) and that the current read no longer returns. These are *candidate*
 * un-ratings — each must still be confirmed against live Plex before being recorded.
 */
export function detectUnratings(
  previous: Map<string, PlexRatingPayload>,
  current: PlexRatedItem[]
): string[] {
  const currentKeys = new Set(current.map((item) => item.ratingKey));
  const candidates: string[] = [];
  for (const [ratingKey, payload] of previous) {
    if (payload.rating > 0 && !currentKeys.has(ratingKey)) {
      candidates.push(ratingKey);
    }
  }
  return candidates;
}

/**
 * Confirm one candidate against live Plex. A per-item read guards against the
 * `userRating>=1` filter quirk (an un-starred item simply vanishes, indistinguishable
 * from a glitch). Null means "don't record a clear for this one" — either Plex still
 * reports a rating, or the confirmation read failed and we'd rather skip than guess.
 */
async function confirmUnrating(
  plexToken: string,
  previous: Map<string, PlexRatingPayload>,
  ratingKey: string
): Promise<PlexRatingPayload | null> {
  let liveRating: number | null;
  try {
    liveRating = await getItemRating(plexToken, ratingKey);
  } catch {
    return null;
  }
  if (liveRating !== null && liveRating > 0) return null;

  const prior = previous.get(ratingKey);
  return prior ? { ...prior, rating: 0 } : null;
}

/**
 * Confirm each candidate un-rating against live Plex and append a `rating = 0` clear
 * for the genuinely-unrated ones, as one batched write.
 */
async function recordUnratings(
  userId: number,
  plexToken: string,
  previous: Map<string, PlexRatingPayload>,
  candidates: string[]
): Promise<number> {
  const clears: PlexRatingPayload[] = [];

  // Capped rather than fully parallel: these are per-item reads against the user's
  // own Plex server, and the candidate list can be UNRATE_CANDIDATE_CAP long.
  for (let i = 0; i < candidates.length; i += UNRATE_CONFIRM_CONCURRENCY) {
    const batch = candidates.slice(i, i + UNRATE_CONFIRM_CONCURRENCY);
    const confirmed = await Promise.all(
      batch.map((ratingKey) => confirmUnrating(plexToken, previous, ratingKey))
    );
    clears.push(...confirmed.filter((clear) => clear !== null));
  }

  await appendSignalEvents(userId, "plex_rating", clears);
  return clears.length;
}

/**
 * Read the user's current Plex ratings and append a `plex_rating` event for each one
 * that is new, changed, or newly un-rated since the last ingestion. Un-ratings are
 * confirmed per-item and skipped wholesale when an implausible number disappear at
 * once (a Plex data event, not user action). Returns the number of events written.
 */
export async function ingestUserRatings(
  userId: number,
  plexToken: string
): Promise<number> {
  const current = await getRatedItems(plexToken);
  const previous = latestRatings(await getSignalEvents(userId, "plex_rating"));
  const changes = diffRatings(previous, current);
  await appendSignalEvents(userId, "plex_rating", changes);

  let removals = 0;
  if (current.length > 0) {
    const candidates = detectUnratings(previous, current);
    if (candidates.length > UNRATE_CANDIDATE_CAP) {
      log.warn(
        `Skipping ${candidates.length} un-rating candidate(s) for user ${userId} — ` +
          "exceeds cap, likely a Plex data event rather than user action"
      );
    } else {
      removals = await recordUnratings(userId, plexToken, previous, candidates);
    }
  }
  return changes.length + removals;
}

/**
 * Cumulative per-artist play count reconstructed from the delta series, considering only
 * events recorded at or before `cutoffMs`. Folds last-write-wins per artist; unchanged
 * artists are absent from later deltas and carry their prior value forward. Events arrive
 * oldest-first, so we stop as soon as one is past the cutoff.
 */
export function reconstructPlayCounts(
  events: UserSignalEvent[],
  cutoffMs: number
): Map<string, number> {
  return foldEvents<PlexPlaysPayload, number>(
    events,
    cutoffMs,
    (payload) =>
      (payload.artists ?? []).map(
        (artist) => [artist.name, artist.playCount] as [string, number]
      ),
    "plex_plays"
  );
}

/**
 * Cumulative per-track play count reconstructed from the delta series, considering only
 * events recorded at or before `cutoffMs`. Folds last-write-wins per `ratingKey`; unchanged
 * tracks are absent from later deltas and carry their prior value forward. Events arrive
 * oldest-first, so we stop as soon as one is past the cutoff.
 */
export function reconstructTrackPlayCounts(
  events: UserSignalEvent[],
  cutoffMs: number
): Map<string, TrackPlayState> {
  return foldEvents<PlexTrackPlaysPayload, TrackPlayState>(
    events,
    cutoffMs,
    (payload) =>
      (payload.tracks ?? [])
        .filter((track) => track && typeof track.ratingKey === "string")
        .map((track) => [track.ratingKey, track] as [string, TrackPlayState]),
    "plex_track_plays"
  );
}

/** Fold one track's contribution into its artist's rollup. */
function accumulateArtistTrack(
  byArtist: Map<string, ArtistPlayRollup>,
  key: string,
  track: TrackPlayState,
  plays: number
): void {
  const listenedMs = inferListenedMs(plays, track.durationMs);
  const existing = byArtist.get(key);
  if (!existing) {
    byArtist.set(key, {
      artistKey: key,
      name: track.artistName,
      playCount: plays,
      listenedMs,
      distinctTracksPlayed: plays > 0 ? 1 : 0,
      topTrackPlayCount: plays,
      topTrackListenedMs: listenedMs,
      topTrackKey: track.ratingKey,
    });
    return;
  }
  existing.playCount += plays;
  existing.listenedMs += listenedMs;
  if (plays > 0) existing.distinctTracksPlayed += 1;
  if (plays > existing.topTrackPlayCount) {
    existing.topTrackPlayCount = plays;
    existing.topTrackKey = track.ratingKey;
  }
  if (listenedMs > existing.topTrackListenedMs) {
    existing.topTrackListenedMs = listenedMs;
  }
  if (!existing.name) existing.name = track.artistName;
}

/**
 * Per-artist plays accumulated from the track fold, with the distribution of those plays
 * across the artist's tracks. Grouped by `artistKey` so a Plex rename keeps one bucket and
 * two same-named artists stay separate; artists whose rows carry no key at all fall back to
 * grouping by name.
 *
 * Passing `baseline` (an earlier fold of the same series) rolls up the *change* since then
 * per track, so the distribution describes what was played inside a window rather than
 * all-time. Tracks unchanged since the baseline count as unplayed for that window.
 */
export function rollupToArtists(
  tracks: Map<string, TrackPlayState>,
  baseline?: Map<string, TrackPlayState>
): ArtistPlayRollup[] {
  const byArtist = new Map<string, ArtistPlayRollup>();
  for (const track of tracks.values()) {
    const key = track.artistKey || track.artistName;
    if (!key) continue;

    const plays = baseline
      ? Math.max(
          0,
          track.playCount - (baseline.get(track.ratingKey)?.playCount ?? 0)
        )
      : track.playCount;

    accumulateArtistTrack(byArtist, key, track, plays);
  }
  return Array.from(byArtist.values());
}

/** Per-album cumulative plays accumulated from the same track fold. */
export function rollupToAlbums(
  tracks: Map<string, TrackPlayState>
): AlbumPlayRollup[] {
  const byAlbum = new Map<string, AlbumPlayRollup>();
  for (const track of tracks.values()) {
    if (!track.albumKey && !track.albumTitle) continue;
    const key = track.albumKey || `${track.artistName}:${track.albumTitle}`;
    const existing = byAlbum.get(key);
    if (existing) {
      existing.playCount += track.playCount;
    } else {
      byAlbum.set(key, {
        albumKey: key,
        title: track.albumTitle,
        artistName: track.artistName,
        playCount: track.playCount,
      });
    }
  }
  return Array.from(byAlbum.values());
}

/**
 * Cumulative per-album track count reconstructed from the delta series, considering only
 * events recorded at or before `cutoffMs`. Folds last-write-wins per `ratingKey`; unchanged
 * albums are absent from later deltas and carry their prior value forward.
 */
export function reconstructAlbumTrackCounts(
  events: UserSignalEvent[],
  cutoffMs: number
): Map<string, AlbumTrackState> {
  return foldEvents<PlexAlbumTracksPayload, AlbumTrackState>(
    events,
    cutoffMs,
    (payload) =>
      (payload.albums ?? [])
        .filter((album) => album && typeof album.ratingKey === "string")
        .map((album) => [album.ratingKey, album] as [string, AlbumTrackState]),
    "plex_album_tracks"
  );
}

/**
 * How many tracks the library holds per artist, summed over their albums. Grouped by
 * `artistKey` so a rename keeps one bucket, then keyed by name — the key everything joining
 * onto the weight set uses — with two same-named artists collapsing to the larger catalogue.
 *
 * An album deleted from Plex keeps its last known count (the fold has no delete event), so
 * this over-counts rather than under-counts. That is the safe direction: availability only
 * ever *exempts* an artist from the one-hit discount, and an inflated count exempts nobody.
 */
export function rollupToArtistCatalogue(
  albums: Map<string, AlbumTrackState>
): Map<string, number> {
  const byKey = new Map<string, { name: string; trackCount: number }>();
  for (const album of albums.values()) {
    const key = album.artistKey || album.artistName;
    if (!key) continue;

    const existing = byKey.get(key);
    if (existing) {
      existing.trackCount += album.trackCount;
      if (!existing.name) existing.name = album.artistName;
    } else {
      byKey.set(key, { name: album.artistName, trackCount: album.trackCount });
    }
  }

  const byName = new Map<string, number>();
  for (const { name, trackCount } of byKey.values()) {
    if (!name) continue;
    byName.set(name, Math.max(byName.get(name) ?? 0, trackCount));
  }
  return byName;
}

/** Inferred listening time for a run of plays on one track. */
export function inferListenedMs(
  playCount: number,
  durationMs: number | undefined
): number {
  return (
    playCount * (durationMs && durationMs > 0 ? durationMs : NOMINAL_TRACK_MS)
  );
}

/**
 * `playFloor` is the count already stored for the track. It only matters for a row emitted
 * solely to backfill `durationMs`, where the live count may have gone backwards (a Plex
 * history clear) and the series must stay monotonic.
 */
const toTrackPlayState = (
  track: TrackPlayCount,
  playFloor: number
): TrackPlayState => ({
  ratingKey: track.ratingKey,
  title: track.title,
  artistKey: track.artistKey,
  artistName: track.artistName,
  albumKey: track.albumKey,
  albumTitle: track.albumTitle,
  playCount: Math.max(track.viewCount, playFloor),
  durationMs: track.durationMs,
});

/**
 * Whether a stored track carries no length while Plex now reports one — rows written before
 * the field existed, and tracks Plex only later got a duration for. The play count is
 * unchanged, so nothing else would ever rewrite the event, and until one is written the
 * track's listening time can only be inferred at a nominal length. Gated on Plex actually
 * reporting a length, or the tracks it has none for would re-emit on every sweep forever.
 */
function needsDurationBackfill(
  prior: TrackPlayState | undefined,
  track: TrackPlayCount
): boolean {
  return prior !== undefined && !prior.durationMs && track.durationMs > 0;
}

/**
 * Append `plex_track_plays` deltas capturing only the tracks whose cumulative play count
 * *increased* since the last capture — tunearr's own durable copy of the signal Plex can
 * lose, and the series the recommender diffs to derive play trends. Counts are treated as
 * monotonic: a decrease or a vanished track (Plex history clear / re-import) is never
 * recorded, so the stored value is the max ever seen and a transient-empty read is a no-op.
 *
 * Tracks whose stored state predates `durationMs` are re-emitted too, which backfills the
 * whole existing series on the first sweep after deploy. When nothing increased and nothing
 * needs backfilling, no event is written.
 */
export async function ingestUserTrackPlays(
  userId: number,
  plexToken: string
): Promise<void> {
  const live = await getAllTrackPlayCounts(plexToken);
  const stored = reconstructTrackPlayCounts(
    await getSignalEvents(userId, "plex_track_plays"),
    Infinity
  );
  const changed: TrackPlayState[] = [];
  for (const track of live) {
    const prior = stored.get(track.ratingKey);
    const grew = track.viewCount > (prior?.playCount ?? 0);
    if (!grew && !needsDurationBackfill(prior, track)) continue;
    changed.push(toTrackPlayState(track, prior?.playCount ?? 0));
  }
  if (changed.length === 0) return;

  const chunks: PlexTrackPlaysPayload[] = [];
  for (let i = 0; i < changed.length; i += MAX_TRACKS_PER_EVENT) {
    chunks.push({ tracks: changed.slice(i, i + MAX_TRACKS_PER_EVENT) });
  }
  await appendSignalEvents(userId, "plex_track_plays", chunks);
}

const toAlbumTrackState = (album: AlbumTrackCount): AlbumTrackState => ({
  ratingKey: album.ratingKey,
  title: album.title,
  artistKey: album.artistKey,
  artistName: album.artistName,
  trackCount: album.trackCount,
});

/**
 * Append `plex_album_tracks` deltas capturing only the albums whose track count changed
 * since the last capture — how much music the library actually holds per artist, which the
 * played-track sweep can't see (it never fetches an unplayed track). Unlike plays, a track
 * count is not monotonic: an album can legitimately shrink, so any difference is recorded.
 * When nothing changed, no event is written.
 */
export async function ingestUserAlbumTracks(
  userId: number,
  plexToken: string
): Promise<void> {
  const live = await getAllAlbumTrackCounts(plexToken);
  const stored = reconstructAlbumTrackCounts(
    await getSignalEvents(userId, "plex_album_tracks"),
    Infinity
  );
  const changed = live.filter(
    (album) => album.trackCount !== stored.get(album.ratingKey)?.trackCount
  );
  if (changed.length === 0) return;

  const chunks: PlexAlbumTracksPayload[] = [];
  for (let i = 0; i < changed.length; i += MAX_TRACKS_PER_EVENT) {
    chunks.push({
      albums: changed.slice(i, i + MAX_TRACKS_PER_EVENT).map(toAlbumTrackState),
    });
  }
  await appendSignalEvents(userId, "plex_album_tracks", chunks);
}

/** Whether a new capture of a series is due — true when none exists or the last is older than the interval. */
export function captureDue(
  events: UserSignalEvent[],
  now: number,
  intervalMs: number
): boolean {
  const last = events[events.length - 1];
  if (!last) return true;
  return now - Date.parse(last.recorded_at) >= intervalMs;
}
