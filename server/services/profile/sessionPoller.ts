import { getConfigValue } from "../../config";
import { getActiveSessions } from "../../api/plex/sessions";
import { getSignalIngestionUsers } from "../../db/userProfile";
import {
  observeSessions,
  recordMeasuredEpisodes,
  resetWatches,
  retireWatches,
} from "./listenSessions";
import { createLogger } from "../../logger";

const log = createLogger("listen-session-poller");

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

/**
 * One poll of every enabled user's active sessions: advance the windows still playing and
 * commit the ones that ended. A user whose read fails keeps their windows open — retiring
 * them on a failed poll would commit every one of them early, at whatever partial time we
 * happened to have.
 */
export async function runListenSessionPollOnce(
  now = Date.now()
): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    if (!getConfigValue("promotedAlbum").ratingsBackupEnabled) return 0;

    const users = await getSignalIngestionUsers();
    let written = 0;

    for (const user of users) {
      try {
        const sessions = await getActiveSessions(user.plexToken);
        const live = observeSessions(user.userId, sessions, now);
        written += await recordMeasuredEpisodes(
          user.userId,
          retireWatches(user.userId, live)
        );
      } catch (error) {
        log.error(`Session poll failed for user ${user.userId}`, error);
      }
    }

    if (written > 0) log.info(`Recorded ${written} measured listen episode(s)`);
    return written;
  } finally {
    running = false;
  }
}

export function startListenSessionPoller(intervalMs: number): void {
  if (timer) return;

  const tick = async () => {
    try {
      await runListenSessionPollOnce();
    } catch (error) {
      log.error("Session poll tick failed", error);
    } finally {
      timer = setTimeout(tick, intervalMs);
    }
  };

  timer = setTimeout(tick, intervalMs);
  log.info(`Listen session poller scheduled (interval: ${intervalMs}ms)`);
}

export function stopListenSessionPoller(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  resetWatches();
}
