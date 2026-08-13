import { getConfigValue } from "../../config";
import { getProfileRegenCandidates } from "../../db/userProfile";
import {
  isProfileFresh,
  loadFreshProfile,
} from "../../promotedAlbum/profileService";
import { createLogger } from "../../logger";

const log = createLogger("profile-regen-poller");

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

/**
 * One regeneration sweep: refresh every profile that is stale AND belongs to a
 * recently-active user, so live requests always hit a warm row. Fresh profiles
 * and dormant users are skipped. Regeneration goes through `loadFreshProfile`, so
 * the Phase 2 per-user in-flight guard prevents collisions with live requests.
 *
 * NOTE: single-instance assumption. A naive interval double-runs under multiple
 * replicas; the in-flight guard is per-process and does not coordinate across them.
 */
export async function runProfileRegenOnce(now = Date.now()): Promise<void> {
  if (running) {
    log.warn("Regen already running, skipping this tick");
    return;
  }
  running = true;
  try {
    const config = getConfigValue("promotedAlbum");
    if (!config.backgroundRegenEnabled) return;

    const activeWindowMs =
      config.backgroundRegenActiveWithinMinutes * 60 * 1000;
    const candidates = await getProfileRegenCandidates();

    let regenerated = 0;
    // Deliberately serial: each regen fans out to Plex and Last.fm, so running users
    // concurrently would burst both rate limiters for no gain on a background sweep.
    for (const candidate of candidates) {
      if (isProfileFresh(candidate.profile, config, now)) continue;
      const lastUsed = Date.parse(candidate.profile.last_used_at);
      if (now - lastUsed > activeWindowMs) continue;

      try {
        await loadFreshProfile(candidate.userId, candidate.plexToken, config);
        regenerated += 1;
      } catch (error) {
        log.error(`Regen failed for user ${candidate.userId}`, error);
      }
    }

    if (regenerated > 0) {
      log.info(`Regenerated ${regenerated} stale profile(s)`);
    }
  } finally {
    running = false;
  }
}

export function startProfileRegenPoller(
  intervalMs: number = DEFAULT_INTERVAL_MS
): void {
  if (timer) return;

  const tick = async () => {
    try {
      await runProfileRegenOnce();
    } catch (error) {
      log.error("Regen tick failed", error);
    } finally {
      timer = setTimeout(tick, intervalMs);
    }
  };

  timer = setTimeout(tick, FIRST_RUN_DELAY_MS);
  log.info(`Profile regen poller scheduled (interval: ${intervalMs / 1000}s)`);
}

export function stopProfileRegenPoller(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
