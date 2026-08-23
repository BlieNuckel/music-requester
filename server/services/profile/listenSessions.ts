import { appendSignalEvents, getSignalEvents } from "../../db/userProfile";
import { foldEpisodes, reconstructListenEpisodes } from "./listenHistory";
import type { PlexTrackSession } from "../../api/plex/sessions";
import type { ListenEpisode, PlexListenHistoryPayload } from "./listenHistory";
import type { UserSignalEvent } from "../../db/entity/UserSignalEvent";

/**
 * One track being watched across polls. Held in memory only: a restart loses the windows in
 * flight, which is the accepted cost of the one source that can see listening no play was
 * ever committed for.
 */
export type SessionWatch = {
  userId: number;
  ratingKey: string;
  title: string;
  artistKey: string;
  artistName: string;
  albumKey: string;
  albumTitle: string;
  durationMs: number;
  /** Epoch ms playback started, back-derived from the offset at first sight. */
  startedAt: number;
  lastOffsetMs: number;
  lastSeenAt: number;
  listenedMs: number;
};

/** Floor on the join tolerance, for an episode whose length is unknown on both sides. */
const MIN_JOIN_TOLERANCE_MS = 1_000;

/**
 * How far the playback position may run ahead of wall clock between two polls before the
 * jump reads as a seek rather than as listening. Covers poll jitter and the client's own
 * reporting lag; a real seek clears it by orders of magnitude.
 */
const SEEK_SLACK_MS = 5_000;

/**
 * Below this, an episode is indistinguishable from poll noise — a client loading a track,
 * a position reported twice a beat apart. Skips are their own signal and belong in their
 * own series, not here as one-second episodes.
 */
const MIN_EPISODE_MS = 5_000;

const MAX_EPISODES_PER_EVENT = 2000;

const watches = new Map<string, SessionWatch>();

/**
 * Identity of one playback window: which client, which session on it, which track. All
 * three are needed — a client can restart a track under the same session key, and two
 * clients can hold the same track at once.
 */
export const watchKey = (
  userId: number,
  session: Pick<
    PlexTrackSession,
    "machineIdentifier" | "sessionKey" | "ratingKey"
  >
): string =>
  `${userId}:${session.machineIdentifier}:${session.sessionKey}:${session.ratingKey}`;

/** Dedup key for the measured series: one episode per track per start. */
export const measuredEpisodeKey = (
  ratingKey: string,
  startedAt: number
): string => `${ratingKey}@${startedAt}`;

/** Every stored measured episode, keyed by track and start. */
export function reconstructMeasuredEpisodes(
  events: UserSignalEvent[],
  cutoffMs: number
): Map<string, ListenEpisode> {
  return foldEpisodes(
    events,
    cutoffMs,
    (episode) =>
      typeof episode.startedAt === "number"
        ? measuredEpisodeKey(episode.ratingKey, episode.startedAt)
        : null,
    "plex_listen_sessions"
  );
}

function startWatch(
  userId: number,
  session: PlexTrackSession,
  now: number
): SessionWatch {
  return {
    userId,
    ratingKey: session.ratingKey,
    title: session.title,
    artistKey: session.artistKey,
    artistName: session.artistName,
    albumKey: session.albumKey,
    albumTitle: session.albumTitle,
    durationMs: session.durationMs,
    startedAt: now - session.viewOffsetMs,
    lastOffsetMs: session.viewOffsetMs,
    lastSeenAt: now,
    listenedMs: 0,
  };
}

/**
 * Credit the ground actually covered since the last poll.
 *
 * The position is the evidence, not `Player.state` — that has been observed reporting
 * `paused` while audio was playing, and a paused client reports an unchanged offset anyway.
 * A jump larger than the elapsed wall clock is a seek and earns nothing: it is the same
 * path that lets someone skip past the halfway mark and commit a play having heard none of
 * the track. A backwards jump (a restart, a scrub back) earns nothing either, and re-bases.
 */
function advanceWatch(
  watch: SessionWatch,
  session: PlexTrackSession,
  now: number
): void {
  const wallDelta = now - watch.lastSeenAt;
  const offsetDelta = session.viewOffsetMs - watch.lastOffsetMs;

  if (offsetDelta > 0 && offsetDelta <= wallDelta + SEEK_SLACK_MS) {
    watch.listenedMs += offsetDelta;
  }
  watch.lastOffsetMs = session.viewOffsetMs;
  watch.lastSeenAt = now;
  if (!watch.durationMs && session.durationMs) {
    watch.durationMs = session.durationMs;
  }
}

/**
 * Fold this poll's sessions for one user into the watch set. Returns the keys the user
 * currently holds, so the caller can retire the rest — and only for users whose read
 * actually succeeded, or a failed poll would commit every window early.
 */
export function observeSessions(
  userId: number,
  sessions: PlexTrackSession[],
  now: number
): Set<string> {
  const live = new Set<string>();

  for (const session of sessions) {
    const key = watchKey(userId, session);
    live.add(key);

    const existing = watches.get(key);
    if (existing) {
      advanceWatch(existing, session, now);
    } else {
      watches.set(key, startWatch(userId, session, now));
    }
  }
  return live;
}

function toMeasuredEpisode(watch: SessionWatch): ListenEpisode {
  return {
    ratingKey: watch.ratingKey,
    title: watch.title,
    artistKey: watch.artistKey,
    artistName: watch.artistName,
    albumKey: watch.albumKey,
    albumTitle: watch.albumTitle,
    startedAt: watch.startedAt,
    durationMs: watch.durationMs,
    listenedMs: watch.listenedMs,
    measured: true,
  };
}

/**
 * Retire the watches for `userId` that this poll no longer saw and turn them into episodes.
 * A window that ends between two polls is simply never seen — polling is lossy at the
 * boundaries at any interval, which is why history stays the spine and this only enriches.
 */
export function retireWatches(
  userId: number,
  live: Set<string>
): ListenEpisode[] {
  const episodes: ListenEpisode[] = [];

  for (const [key, watch] of watches) {
    if (watch.userId !== userId || live.has(key)) continue;
    watches.delete(key);
    if (watch.listenedMs >= MIN_EPISODE_MS) {
      episodes.push(toMeasuredEpisode(watch));
    }
  }
  return episodes;
}

/** Drop every in-flight watch. For shutdown and for tests, which must not leak state. */
export function resetWatches(): void {
  watches.clear();
}

/**
 * Append `plex_listen_sessions` events for the episodes that just ended, skipping any whose
 * (track, start) is already stored so a repeated commit is a no-op. Returns how many were
 * written.
 */
export async function recordMeasuredEpisodes(
  userId: number,
  episodes: ListenEpisode[]
): Promise<number> {
  if (episodes.length === 0) return 0;

  const stored = reconstructMeasuredEpisodes(
    await getSignalEvents(userId, "plex_listen_sessions"),
    Infinity
  );
  const fresh = episodes.filter(
    (episode) =>
      !stored.has(measuredEpisodeKey(episode.ratingKey, episode.startedAt))
  );
  if (fresh.length === 0) return 0;

  const chunks: PlexListenHistoryPayload[] = [];
  for (let i = 0; i < fresh.length; i += MAX_EPISODES_PER_EVENT) {
    chunks.push({ episodes: fresh.slice(i, i + MAX_EPISODES_PER_EVENT) });
  }
  await appendSignalEvents(userId, "plex_listen_sessions", chunks);
  return fresh.length;
}

/**
 * Whether a measured episode and a history episode describe the same playback: the same
 * track, started within the track's own length of each other. History derives its start
 * from the halfway commit, so the two never agree exactly — the tolerance is the width of
 * the error that derivation can carry.
 */
function describesSamePlay(
  measured: ListenEpisode,
  historical: ListenEpisode
): boolean {
  const tolerance = Math.max(
    measured.durationMs,
    historical.durationMs,
    MIN_JOIN_TOLERANCE_MS
  );
  return Math.abs(measured.startedAt - historical.startedAt) <= tolerance;
}

/** History episodes bucketed by track, so the join scans one track's plays, not all of them. */
function indexByTrack(
  history: Map<string, ListenEpisode>
): Map<string, string[]> {
  const byTrack = new Map<string, string[]>();
  for (const [key, episode] of history) {
    const keys = byTrack.get(episode.ratingKey);
    if (keys) keys.push(key);
    else byTrack.set(episode.ratingKey, [key]);
  }
  return byTrack;
}

/**
 * One series describing each play once. History is the record of *which* plays happened;
 * where a measured episode witnessed the same play, its observed time replaces the inferred
 * estimate, keeping history's own `viewedAt`. Measured episodes matching nothing are
 * appended — that is playback abandoned before it ever committed a play, which is invisible
 * to every other source and the reason this layer exists.
 */
export function mergeMeasuredEpisodes(
  history: Map<string, ListenEpisode>,
  measured: Map<string, ListenEpisode>
): Map<string, ListenEpisode> {
  const merged = new Map(history);
  const byTrack = indexByTrack(history);

  for (const episode of measured.values()) {
    let joined = false;
    for (const key of byTrack.get(episode.ratingKey) ?? []) {
      const historical = merged.get(key);
      if (!historical || !describesSamePlay(episode, historical)) continue;
      merged.set(key, {
        ...historical,
        listenedMs: episode.listenedMs,
        measured: true,
      });
      joined = true;
      break;
    }
    if (joined) continue;

    merged.set(
      measuredEpisodeKey(episode.ratingKey, episode.startedAt),
      episode
    );
  }
  return merged;
}

/**
 * Both episode series as one, measured time replacing inferred wherever a session witnessed
 * the play. The weighting deliberately cannot tell which it got — that is what makes the
 * millisecond currency worth the trouble.
 */
export async function loadEpisodeSeries(
  userId: number
): Promise<Map<string, ListenEpisode>> {
  return mergeMeasuredEpisodes(
    reconstructListenEpisodes(
      await getSignalEvents(userId, "plex_listen_history"),
      Infinity
    ),
    reconstructMeasuredEpisodes(
      await getSignalEvents(userId, "plex_listen_sessions"),
      Infinity
    )
  );
}
