import { historyCovers } from "./listenHistory";
import { inferListenedMs, reconstructTrackPlayCounts } from "./signalIngestion";
import { normalizeAlbumKey } from "../../utils/albumKey";
import type { ListenEpisode } from "./listenHistory";
import type { ArtistPlayRollup, TrackPlayState } from "./signalIngestion";
import type { UserSignalEvent } from "../../db/entity/UserSignalEvent";

/**
 * One track's listening inside a resolved window. Both series normalize into this, which is
 * what lets a single rollup answer by artist and by album: before it, each source carried
 * its own rollup family, and picking the wrong one measured a window from the wrong series.
 *
 * `listenedMs` already sits under the per-play ceiling, so nothing downstream re-applies it.
 */
export type WindowedPlay = {
  ratingKey: string;
  artistKey: string;
  artistName: string;
  albumKey: string;
  albumTitle: string;
  plays: number;
  listenedMs: number;
};

/**
 * Which series answered for the window. `allTime` means no window was measured at all and
 * the rows are the plain cumulative fold — the honest state to be in when the log is younger
 * than the window, or nothing was played inside it.
 */
export type WindowSource = "episodes" | "deltas" | "allTime";

/**
 * The span every per-artist, per-album and per-track figure is measured over, settled once,
 * with the listening it holds. `startMs` is null exactly when `source` is `allTime`.
 */
export type ListeningWindow = {
  startMs: number | null;
  source: WindowSource;
  plays: Map<string, WindowedPlay>;
};

/**
 * One album's listening over a window. Its own type rather than the shared play rollup
 * because it carries `distinctTracksPlayed`, which only rows can answer and which is what
 * separates a record someone has been through from one hit they played on repeat.
 */
export type AlbumListening = {
  albumKey: string;
  title: string;
  artistKey: string;
  artistName: string;
  plays: number;
  listenedMs: number;
  distinctTracksPlayed: number;
};

export type WindowOptions = {
  now: number;
  windowMs: number;
  /** Per-play ceiling on listening credit, in ms; `0` is uncapped. */
  capMs: number;
};

/**
 * Plays a record needs before it counts as one the user already knows. A stray play or two
 * is what discovery looks like from the inside; this is the line past which recommending it
 * back to them says nothing they do not already have.
 */
const KNOWN_ALBUM_MIN_PLAYS = 5;

/** Distinct tracks off a record before those plays describe the record, not one song. */
const KNOWN_ALBUM_MIN_TRACKS = 2;

/** Cap on stored keys, so a huge library cannot turn the profile document into a payload. */
const KNOWN_ALBUM_LIMIT = 500;

/** `recorded_at` of the oldest event in the series, or null when it has none. */
function earliestRecordedAt(events: UserSignalEvent[]): number | null {
  const first = events[0];
  return first === undefined ? null : Date.parse(first.recorded_at);
}

/**
 * The cumulative fold as rows, or the increase in each row since `baseline`. Tracks
 * unchanged since the baseline stay, at zero plays: they are catalogue the artist holds, and
 * dropping them would make an artist's spread look narrower than it is.
 */
function rowsFromTracks(
  latest: Map<string, TrackPlayState>,
  baseline: Map<string, TrackPlayState> | undefined,
  capMs: number
): Map<string, WindowedPlay> {
  const rows = new Map<string, WindowedPlay>();

  for (const track of latest.values()) {
    const plays = baseline
      ? Math.max(
          0,
          track.playCount - (baseline.get(track.ratingKey)?.playCount ?? 0)
        )
      : track.playCount;

    rows.set(track.ratingKey, {
      ratingKey: track.ratingKey,
      artistKey: track.artistKey,
      artistName: track.artistName,
      albumKey: track.albumKey,
      albumTitle: track.albumTitle,
      plays,
      listenedMs: inferListenedMs(plays, track.durationMs, capMs),
    });
  }
  return rows;
}

/**
 * Episodes started inside `[fromMs, toMs)`, grouped to one row per track. Windowed on
 * `startedAt` rather than `viewedAt`, so a long set counts against the window it was played
 * in rather than the one its play happened to commit in.
 */
function rowsFromEpisodes(
  episodes: Map<string, ListenEpisode>,
  fromMs: number,
  toMs: number,
  capMs: number
): Map<string, WindowedPlay> {
  const rows = new Map<string, WindowedPlay>();

  for (const episode of episodes.values()) {
    if (episode.startedAt < fromMs || episode.startedAt >= toMs) continue;
    const listenedMs =
      capMs > 0 ? Math.min(episode.listenedMs, capMs) : episode.listenedMs;

    const existing = rows.get(episode.ratingKey);
    if (!existing) {
      rows.set(episode.ratingKey, {
        ratingKey: episode.ratingKey,
        artistKey: episode.artistKey,
        artistName: episode.artistName,
        albumKey: episode.albumKey,
        albumTitle: episode.albumTitle,
        plays: 1,
        listenedMs,
      });
      continue;
    }
    existing.plays += 1;
    existing.listenedMs += listenedMs;
    if (!existing.artistKey) existing.artistKey = episode.artistKey;
    if (!existing.artistName) existing.artistName = episode.artistName;
    if (!existing.albumKey) existing.albumKey = episode.albumKey;
    if (!existing.albumTitle) existing.albumTitle = episode.albumTitle;
  }
  return rows;
}

/** Whether a window holds any listening at all, on either quantity. */
function hasListening(rows: Map<string, WindowedPlay>): boolean {
  for (const row of rows.values()) {
    if (row.plays > 0 || row.listenedMs > 0) return true;
  }
  return false;
}

/** All-time listening as rows: the fold with no window applied. */
export function allTimeListening(
  trackEvents: UserSignalEvent[],
  capMs = 0
): Map<string, WindowedPlay> {
  return rowsFromTracks(
    reconstructTrackPlayCounts(trackEvents, Infinity),
    undefined,
    capMs
  );
}

/**
 * Settle the recent window and measure the listening inside it, once, for everything that
 * reads it. The episode log answers where it reaches back that far, the difference of two
 * cumulative folds answers before that, and all-time answers when neither reaches or nothing
 * was played inside the window. One series or the other, never both, or every play in the
 * covered span would count twice.
 *
 * Deciding this per derivation is what once left the artist weights measured from the
 * episodes while the one-hit discount was measured from the count deltas — a ratio from one
 * series scaling a magnitude from another, which disagree exactly where the episode series
 * earns its keep: a long set abandoned halfway.
 *
 * A user with no play captures gets an empty window rather than one derived from episodes
 * alone. The episode series joins durations from the play series, so without it there is
 * nothing to measure against.
 */
export function resolveListeningWindow(
  trackEvents: UserSignalEvent[],
  episodes: Map<string, ListenEpisode>,
  options: WindowOptions
): ListeningWindow {
  const { now, windowMs, capMs } = options;
  const latest = reconstructTrackPlayCounts(trackEvents, Infinity);
  const allTime: ListeningWindow = {
    startMs: null,
    source: "allTime",
    plays: rowsFromTracks(latest, undefined, capMs),
  };

  const earliest = earliestRecordedAt(trackEvents);
  if (earliest === null) return allTime;

  const startMs = now - windowMs;
  if (historyCovers(episodes, startMs)) {
    const plays = rowsFromEpisodes(episodes, startMs, now, capMs);
    return hasListening(plays)
      ? { startMs, source: "episodes", plays }
      : allTime;
  }
  if (earliest > startMs) return allTime;

  const plays = rowsFromTracks(
    latest,
    reconstructTrackPlayCounts(trackEvents, startMs),
    capMs
  );
  return hasListening(plays) ? { startMs, source: "deltas", plays } : allTime;
}

/**
 * Per-artist listening, with the distribution of it across the artist's tracks. Grouped by
 * `artistKey` so a Plex rename keeps one bucket and two same-named artists stay separate;
 * rows carrying no key at all fall back to grouping by name.
 *
 * `topTrackKey` names the most-*played* track while `topTrackListenedMs` measures the
 * longest-listened one, which are not always the same track. Only the second feeds the
 * concentration measure; the key is carried for callers that want to name the track.
 */
export function rollupWindowToArtists(
  plays: Map<string, WindowedPlay>
): ArtistPlayRollup[] {
  const byArtist = new Map<string, ArtistPlayRollup>();

  for (const row of plays.values()) {
    const key = row.artistKey || row.artistName;
    if (!key) continue;

    const existing = byArtist.get(key);
    if (!existing) {
      byArtist.set(key, {
        artistKey: key,
        name: row.artistName,
        playCount: row.plays,
        listenedMs: row.listenedMs,
        distinctTracksPlayed: row.plays > 0 ? 1 : 0,
        topTrackPlayCount: row.plays,
        topTrackListenedMs: row.listenedMs,
        topTrackKey: row.ratingKey,
      });
      continue;
    }
    existing.playCount += row.plays;
    existing.listenedMs += row.listenedMs;
    if (row.plays > 0) existing.distinctTracksPlayed += 1;
    if (row.plays > existing.topTrackPlayCount) {
      existing.topTrackPlayCount = row.plays;
      existing.topTrackKey = row.ratingKey;
    }
    if (row.listenedMs > existing.topTrackListenedMs) {
      existing.topTrackListenedMs = row.listenedMs;
    }
    if (!existing.name) existing.name = row.artistName;
  }
  return Array.from(byArtist.values());
}

/**
 * The same rollup keyed by artist name, which is what the ratings series joins on and what
 * the weight set is ranked by. Two artists sharing a name collapse to whichever holds more
 * listening, whole rather than field by field: a merged row mixing one artist's play count
 * with another's top track describes nobody.
 */
export function artistRollupsByName(
  rollups: ArtistPlayRollup[]
): Map<string, ArtistPlayRollup> {
  const byName = new Map<string, ArtistPlayRollup>();

  for (const rollup of rollups) {
    if (!rollup.name) continue;
    const existing = byName.get(rollup.name);
    if (!existing || rollup.listenedMs > existing.listenedMs) {
      byName.set(rollup.name, rollup);
    }
  }
  return byName;
}

/**
 * Per-album listening over the same window. Rows with no album at all are dropped rather
 * than pooled under an empty key: an album share is only meaningful against an album.
 */
export function rollupWindowToAlbums(
  plays: Map<string, WindowedPlay>
): AlbumListening[] {
  const byAlbum = new Map<string, AlbumListening>();

  for (const row of plays.values()) {
    if (!row.albumKey && !row.albumTitle) continue;
    const key = row.albumKey || `${row.artistName}:${row.albumTitle}`;

    const existing = byAlbum.get(key);
    if (!existing) {
      byAlbum.set(key, {
        albumKey: key,
        title: row.albumTitle,
        artistKey: row.artistKey,
        artistName: row.artistName,
        plays: row.plays,
        listenedMs: row.listenedMs,
        distinctTracksPlayed: row.plays > 0 ? 1 : 0,
      });
      continue;
    }
    existing.plays += row.plays;
    existing.listenedMs += row.listenedMs;
    if (row.plays > 0) existing.distinctTracksPlayed += 1;
    if (!existing.title) existing.title = row.albumTitle;
    if (!existing.artistName) existing.artistName = row.artistName;
    if (!existing.artistKey) existing.artistKey = row.artistKey;
  }
  return Array.from(byAlbum.values());
}

/**
 * The records this user has actually been through, as normalized keys, most-played first —
 * what keeps recommendations off things they already have.
 *
 * Two conditions, not one. Plays alone marked a record known off a single hit played five
 * times, which is the opposite of knowing it: they know one song, and the album is exactly
 * the kind of thing worth recommending. Requiring a second track played says they have been
 * past the single, while staying true for a two-track release nobody would call unfamiliar.
 */
export function deriveKnownAlbums(
  tracks: Map<string, WindowedPlay>,
  minPlays = KNOWN_ALBUM_MIN_PLAYS,
  limit = KNOWN_ALBUM_LIMIT
): string[] {
  return rollupWindowToAlbums(tracks)
    .filter(
      (album) =>
        album.title &&
        album.plays >= minPlays &&
        album.distinctTracksPlayed >= KNOWN_ALBUM_MIN_TRACKS
    )
    .sort((a, b) => b.plays - a.plays)
    .slice(0, limit)
    .map((album) => normalizeAlbumKey(album.artistName, album.title));
}
