import { getConfig } from "../../config";
import { isLiveEventsConfigured } from "../../api/jambase/config";
import { createLogger } from "../../logger";
import { resolveFollowedArtists } from "./resolution";
import { runRosterSweep } from "./rosterSweep";
import { runGeoSweep } from "./geoSweep";

const log = createLogger("live-poller");

const FIRST_RUN_DELAY_MS = 45 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Resolution is capped per tick so a large first import cannot spend a month of
 * quota in one go: one call per artist, and the rest wait for the next tick.
 */
const RESOLUTION_LIMIT_PER_TICK = 25;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

export async function runLivePollOnce(): Promise<void> {
  if (running) {
    log.warn("Live poll already running, skipping this tick");
    return;
  }
  if (!isLiveEventsConfigured()) return;

  running = true;
  try {
    await resolveFollowedArtists(RESOLUTION_LIMIT_PER_TICK);
    await runRosterSweep();
    await runGeoSweep();
  } finally {
    running = false;
  }
}

export function startLiveEventsPoller(intervalMs?: number): void {
  if (timer) return;

  const resolved =
    intervalMs ?? getConfig().liveEvents.sweepIntervalHours * HOUR_MS;

  const tick = async () => {
    try {
      await runLivePollOnce();
    } catch (error) {
      log.error("Live poll tick failed", error);
    } finally {
      timer = setTimeout(tick, resolved);
    }
  };

  timer = setTimeout(tick, FIRST_RUN_DELAY_MS);
  log.info(`Live events poller scheduled (interval: ${resolved / 1000}s)`);
}

export function stopLiveEventsPoller(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
