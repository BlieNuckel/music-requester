import { getConfigValue } from "../config";
import {
  getPromotedAlbums,
  listWarmableUsers,
  promotedAlbumCacheExpiry,
  SPOTLIGHT_COUNT,
} from "./getPromotedAlbum";
import { createLogger } from "../logger";

const log = createLogger("spotlight-warmer");

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 90 * 1000;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

/**
 * A user is warmed when their carousel is gone or will expire before the next tick.
 * Rebuilding earlier than that would re-roll picks a user is still looking at; waiting
 * for the entry to lapse on its own is what leaves the next visitor paying for it.
 */
function isDue(userId: number, intervalMs: number, now: number): boolean {
  const expiresAt = promotedAlbumCacheExpiry(userId, now);
  return expiresAt === undefined || expiresAt - now <= intervalMs;
}

/**
 * One warming sweep. A carousel build resolves candidates against MusicBrainz at ~1
 * req/sec, so leaving it to the request path means whoever loads Discover first after
 * the cache lapses waits out the whole rebuild. Here it happens off-request, on the
 * background MusicBrainz lane, for the users who have actually been looking at it.
 *
 * NOTE: single-instance assumption, same as the other pollers — the interval is not
 * coordinated across replicas.
 */
export async function runSpotlightWarmOnce(
  intervalMs: number = DEFAULT_INTERVAL_MS,
  now: number = Date.now()
): Promise<void> {
  if (running) {
    log.warn("Warm sweep already running, skipping this tick");
    return;
  }
  running = true;
  try {
    const config = getConfigValue("promotedAlbum");
    if (!config.backgroundRegenEnabled) return;

    const due = listWarmableUsers(now).filter((userId) =>
      isDue(userId, intervalMs, now)
    );

    let warmed = 0;
    // Serial for the same reason the regen sweep is: concurrent builds would burst
    // MusicBrainz and Last.fm at once for no gain on background work.
    for (const userId of due) {
      try {
        const result = await getPromotedAlbums(userId, true, SPOTLIGHT_COUNT, {
          source: "warmer",
        });
        if (result.status === "ready" && result.albums.length > 0) warmed += 1;
      } catch (error) {
        log.error(`Warm failed for user ${userId}`, error);
      }
    }

    if (warmed > 0) {
      log.info(`Warmed ${warmed} spotlight carousel(s)`);
    }
  } finally {
    running = false;
  }
}

export function startSpotlightWarmer(
  intervalMs: number = DEFAULT_INTERVAL_MS
): void {
  if (timer) return;

  const tick = async () => {
    try {
      await runSpotlightWarmOnce(intervalMs);
    } catch (error) {
      log.error("Warm tick failed", error);
    } finally {
      timer = setTimeout(tick, intervalMs);
    }
  };

  timer = setTimeout(tick, FIRST_RUN_DELAY_MS);
  log.info(`Spotlight warmer scheduled (interval: ${intervalMs / 1000}s)`);
}

export function stopSpotlightWarmer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
