import { getConfigValue } from "../../config";
import { getSignalEvents, getSignalIngestionUsers } from "../../db/userProfile";
import {
  captureDue,
  ingestUserAlbumTracks,
  ingestUserRatings,
  ingestUserTrackPlays,
} from "./signalIngestion";
import { createLogger } from "../../logger";

const log = createLogger("signal-ingestion-poller");

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;
const PLAYS_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * The album walk is the one capture that reads unplayed items, so it is the one whose cost
 * scales with library size rather than with listening. A library's track counts also change
 * far more slowly than its play counts, so it runs weekly rather than daily.
 */
const CATALOGUE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

/**
 * One ingestion sweep over every enabled user with a Plex token: append any
 * new/changed ratings, and a plays capture if one is due (>= once/day). Per-user
 * failures (e.g. a managed user whose ratings don't resolve) are logged and
 * skipped so one account never aborts the sweep.
 *
 * NOTE: single-instance assumption — a naive interval double-runs under multiple
 * replicas. The append-only log tolerates duplicate captures but would record
 * redundant rows.
 */
export async function runSignalIngestionOnce(now = Date.now()): Promise<void> {
  if (running) {
    log.warn("Signal ingestion already running, skipping this tick");
    return;
  }
  running = true;
  try {
    if (!getConfigValue("promotedAlbum").ratingsBackupEnabled) return;

    const users = await getSignalIngestionUsers();
    let ratingsWritten = 0;
    let playsWritten = 0;
    let cataloguesWritten = 0;

    for (const user of users) {
      try {
        ratingsWritten += await ingestUserRatings(user.userId, user.plexToken);
        const playEvents = await getSignalEvents(
          user.userId,
          "plex_track_plays"
        );
        if (captureDue(playEvents, now, PLAYS_INTERVAL_MS)) {
          await ingestUserTrackPlays(user.userId, user.plexToken);
          playsWritten += 1;
        }

        const albumEvents = await getSignalEvents(
          user.userId,
          "plex_album_tracks"
        );
        if (captureDue(albumEvents, now, CATALOGUE_INTERVAL_MS)) {
          await ingestUserAlbumTracks(user.userId, user.plexToken);
          cataloguesWritten += 1;
        }
      } catch (error) {
        log.error(`Signal ingestion failed for user ${user.userId}`, error);
      }
    }

    if (ratingsWritten > 0 || playsWritten > 0 || cataloguesWritten > 0) {
      log.info(
        `Ingested ${ratingsWritten} rating change(s), ${playsWritten} plays capture(s), ` +
          `${cataloguesWritten} catalogue capture(s)`
      );
    }
  } finally {
    running = false;
  }
}

export function startSignalIngestionPoller(
  intervalMs: number = DEFAULT_INTERVAL_MS
): void {
  if (timer) return;

  const tick = async () => {
    try {
      await runSignalIngestionOnce();
    } catch (error) {
      log.error("Signal ingestion tick failed", error);
    } finally {
      timer = setTimeout(tick, intervalMs);
    }
  };

  timer = setTimeout(tick, FIRST_RUN_DELAY_MS);
  log.info(
    `Signal ingestion poller scheduled (interval: ${intervalMs / 1000}s)`
  );
}

export function stopSignalIngestionPoller(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
