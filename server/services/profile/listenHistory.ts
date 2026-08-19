import { getPlayHistory } from "../../api/plex/playHistory";
import { appendSignalEvents, getSignalEvents } from "../../db/userProfile";
import {
  NOMINAL_TRACK_MS,
  foldEvents,
  reconstructTrackPlayCounts,
} from "./signalIngestion";
import type { PlexHistoryEntry } from "../../api/plex/playHistory";
import type { UserSignalEvent } from "../../db/entity/UserSignalEvent";

/**
 * One discrete listen — a play Plex committed, with the time it happened. The granular unit
 * the cumulative count series cannot express: a counter can say an artist was played twelve
 * times, never that a 90-minute set got twelve minutes and was abandoned.
 */
export type ListenEpisode = {
  ratingKey: string;
  title: string;
  artistKey: string;
  artistName: string;
  albumKey: string;
  albumTitle: string;
  /**
   * Unix **seconds**, exactly as Plex stamped it — when the play committed, not when it
   * began. Absent on an episode that came from watching playback rather than from Plex's
   * event log: an abandoned play commits nothing, so there is no such stamp to record.
   */
  viewedAt?: number;
  /**
   * Epoch **milliseconds** when playback started, derived as `viewedAt - durationMs / 2`
   * because Plex commits a play at the halfway mark. For a 90-minute set that correction is
   * ~45 minutes, and getting it wrong is invisible until something time-of-day shaped
   * quietly comes out wrong.
   */
  startedAt: number;
  /** Track length in ms, joined from the play-count series; nominal when it has none. */
  durationMs: number;
  /** Time credited to this episode. */
  listenedMs: number;
  /**
   * Whether `listenedMs` was observed rather than inferred from the track's length. Always
   * false here — the history endpoint reports no offset. A session observation sets it.
   */
  measured: boolean;
  deviceID?: number;
  accountID?: number;
};

/** Payload of a `kind = "plex_listen_history"` event: a batch of episodes, appended in order. */
export type PlexListenHistoryPayload = {
  episodes: ListenEpisode[];
};

/** Per-artist listening accumulated from episodes inside a window. */
export type ArtistListenRollup = {
  artistKey: string;
  name: string;
  plays: number;
  listenedMs: number;
  topTrackKey: string;
  topTrackListenedMs: number;
};

/**
 * Cap on episodes per event, mirroring the play-count chunking: the first sweep is the
 * entire history of the library and would otherwise be one multi-megabyte `payload` cell.
 */
const MAX_EPISODES_PER_EVENT = 2000;

const MS_PER_SECOND = 1000;

/** Dedup key. Plex can report one play twice (Plexamp replaying an offline queue). */
export const episodeKey = (ratingKey: string, viewedAt: number): string =>
  `${ratingKey}:${viewedAt}`;

/**
 * Replay an episode series from its append-only log, keyed by `keyOf`. Last-write-wins on
 * that key is what makes re-sweeps and Plex's own double-reporting idempotent — a repeat of
 * an episode we already hold overwrites it with itself. An episode `keyOf` cannot key is
 * dropped rather than folded under a bogus key.
 */
export function foldEpisodes(
  events: UserSignalEvent[],
  cutoffMs: number,
  keyOf: (episode: ListenEpisode) => string | null,
  label: string
): Map<string, ListenEpisode> {
  return foldEvents<PlexListenHistoryPayload, ListenEpisode>(
    events,
    cutoffMs,
    (payload) =>
      (payload.episodes ?? [])
        .filter((episode) => episode && typeof episode.ratingKey === "string")
        .flatMap((episode) => {
          const key = keyOf(episode);
          return key === null
            ? []
            : [[key, episode] as [string, ListenEpisode]];
        }),
    label
  );
}

/** Every stored history episode, keyed by (`ratingKey`, `viewedAt`). */
export function reconstructListenEpisodes(
  events: UserSignalEvent[],
  cutoffMs: number
): Map<string, ListenEpisode> {
  return foldEpisodes(
    events,
    cutoffMs,
    (episode) =>
      typeof episode.viewedAt === "number"
        ? episodeKey(episode.ratingKey, episode.viewedAt)
        : null,
    "plex_listen_history"
  );
}

/**
 * The `viewedAt` to resume from, in Unix seconds. Re-requests the newest stored second
 * rather than the one after it, so a play sharing that second with one we already hold is
 * not skipped; the dedup on read makes the overlap free.
 */
export function historyWatermark(stored: Map<string, ListenEpisode>): number {
  let latest = 0;
  for (const episode of stored.values()) {
    if (episode.viewedAt !== undefined && episode.viewedAt > latest) {
      latest = episode.viewedAt;
    }
  }
  return latest;
}

/**
 * When history stops being authoritative, in epoch ms — the oldest listening it covers.
 * Before this, the cumulative count series is the only record: history can be purged by the
 * user under Privacy settings, and predates nothing on a library older than the log.
 */
export function historyCoverageStart(
  episodes: Map<string, ListenEpisode>
): number | null {
  let earliest: number | null = null;
  for (const episode of episodes.values()) {
    if (earliest === null || episode.startedAt < earliest) {
      earliest = episode.startedAt;
    }
  }
  return earliest;
}

/**
 * Whether history is authoritative for everything from `fromMs` onwards. Both series now
 * describe the same plays, so a read layer must pick one per window or count every play
 * twice: history where it reaches, the cumulative count deltas outside it.
 */
export function historyCovers(
  episodes: Map<string, ListenEpisode>,
  fromMs: number
): boolean {
  const start = historyCoverageStart(episodes);
  return start !== null && start <= fromMs;
}

function toEpisode(
  entry: PlexHistoryEntry,
  durations: Map<string, number>
): ListenEpisode {
  const stored = durations.get(entry.ratingKey);
  const durationMs = stored && stored > 0 ? stored : NOMINAL_TRACK_MS;

  return {
    ratingKey: entry.ratingKey,
    title: entry.title,
    artistKey: entry.artistKey,
    artistName: entry.artistName,
    albumKey: entry.albumKey,
    albumTitle: entry.albumTitle,
    viewedAt: entry.viewedAt,
    startedAt: entry.viewedAt * MS_PER_SECOND - Math.round(durationMs / 2),
    durationMs,
    listenedMs: durationMs,
    measured: false,
    deviceID: entry.deviceID,
    accountID: entry.accountID,
  };
}

/** Track lengths from the play-count series, which is the only source that carries them. */
function trackDurations(events: UserSignalEvent[]): Map<string, number> {
  const durations = new Map<string, number>();
  for (const [ratingKey, track] of reconstructTrackPlayCounts(
    events,
    Infinity
  )) {
    if (track.durationMs) durations.set(ratingKey, track.durationMs);
  }
  return durations;
}

/**
 * Per-artist listening from the episodes started inside `[fromMs, toMs)`. Windowed on
 * `startedAt`, not `viewedAt`, so a long set counts against the window it was actually
 * played in rather than the one its play happened to commit in.
 *
 * Grouped by `artistKey` so a Plex rename keeps one bucket and two same-named artists stay
 * separate; episodes carrying no key fall back to grouping by name.
 */
export function rollupEpisodesToArtists(
  episodes: Map<string, ListenEpisode>,
  fromMs = -Infinity,
  toMs = Infinity
): ArtistListenRollup[] {
  const byArtist = new Map<string, ArtistListenRollup>();

  for (const episode of episodes.values()) {
    if (episode.startedAt < fromMs || episode.startedAt >= toMs) continue;
    const key = episode.artistKey || episode.artistName;
    if (!key) continue;

    const existing = byArtist.get(key);
    if (!existing) {
      byArtist.set(key, {
        artistKey: key,
        name: episode.artistName,
        plays: 1,
        listenedMs: episode.listenedMs,
        topTrackKey: episode.ratingKey,
        topTrackListenedMs: episode.listenedMs,
      });
      continue;
    }
    existing.plays += 1;
    existing.listenedMs += episode.listenedMs;
    if (!existing.name) existing.name = episode.artistName;
  }

  applyTopTracks(byArtist, episodes, fromMs, toMs);
  return Array.from(byArtist.values());
}

/**
 * The most-listened track per artist, summed across that track's own episodes — a track
 * heard ten times is what dominates an artist's listening, not whichever single episode was
 * longest.
 */
function applyTopTracks(
  byArtist: Map<string, ArtistListenRollup>,
  episodes: Map<string, ListenEpisode>,
  fromMs: number,
  toMs: number
): void {
  const perTrack = new Map<string, { artist: string; listenedMs: number }>();

  for (const episode of episodes.values()) {
    if (episode.startedAt < fromMs || episode.startedAt >= toMs) continue;
    const artist = episode.artistKey || episode.artistName;
    if (!artist) continue;

    const existing = perTrack.get(episode.ratingKey);
    if (existing) {
      existing.listenedMs += episode.listenedMs;
    } else {
      perTrack.set(episode.ratingKey, {
        artist,
        listenedMs: episode.listenedMs,
      });
    }
  }

  for (const rollup of byArtist.values()) rollup.topTrackListenedMs = 0;
  for (const [ratingKey, track] of perTrack) {
    const rollup = byArtist.get(track.artist);
    if (!rollup || track.listenedMs <= rollup.topTrackListenedMs) continue;
    rollup.topTrackKey = ratingKey;
    rollup.topTrackListenedMs = track.listenedMs;
  }
}

/**
 * Append `plex_listen_history` events for every play Plex's log holds that we don't. The
 * first run backfills the whole log; later runs read from the newest stored `viewedAt`.
 *
 * Track lengths come from the play-count series, which is the only source that carries
 * them; an episode for a track the sweep has not seen yet falls back to a nominal length
 * and is not revisited — the count series is the durable record of length, and this series
 * exists for *when* a play happened.
 *
 * Returns the number of episodes appended.
 */
export async function ingestUserListenHistory(
  userId: number,
  plexToken: string
): Promise<number> {
  const stored = reconstructListenEpisodes(
    await getSignalEvents(userId, "plex_listen_history"),
    Infinity
  );
  const entries = await getPlayHistory(plexToken, historyWatermark(stored));
  const durations = trackDurations(
    await getSignalEvents(userId, "plex_track_plays")
  );

  const fresh: ListenEpisode[] = [];
  for (const entry of entries) {
    const key = episodeKey(entry.ratingKey, entry.viewedAt);
    if (stored.has(key)) continue;
    const episode = toEpisode(entry, durations);
    stored.set(key, episode);
    fresh.push(episode);
  }
  if (fresh.length === 0) return 0;

  const chunks: PlexListenHistoryPayload[] = [];
  for (let i = 0; i < fresh.length; i += MAX_EPISODES_PER_EVENT) {
    chunks.push({ episodes: fresh.slice(i, i + MAX_EPISODES_PER_EVENT) });
  }
  await appendSignalEvents(userId, "plex_listen_history", chunks);
  return fresh.length;
}
