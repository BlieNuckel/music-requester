import { getConfig } from "../../config";
import { isLiveEventsConfigured } from "../../api/jambase/config";
import { createLogger } from "../../logger";
import { resolveFollowedArtists } from "./resolution";
import { runRosterSweep } from "./rosterSweep";
import { runGeoSweep } from "./geoSweep";
import { notifyLiveUpdates } from "./notifier";

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
    await notifyLiveUpdates();
  } finally {
    running = false;
  }
}

function resolveIntervalMs(intervalMs?: number): number {
  return intervalMs ?? getConfig().liveEvents.sweepIntervalHours * HOUR_MS;
}

export function startLiveEventsPoller(
  intervalMs?: number,
  firstRunDelayMs = FIRST_RUN_DELAY_MS
): void {
  if (timer) return;

  const resolved = resolveIntervalMs(intervalMs);

  const tick = async () => {
    try {
      await runLivePollOnce();
    } catch (error) {
      log.error("Live poll tick failed", error);
    } finally {
      timer = setTimeout(tick, resolved);
    }
  };

  timer = setTimeout(tick, firstRunDelayMs);
  log.info(`Live events poller scheduled (interval: ${resolved / 1000}s)`);
}

/**
 * Pick up a changed sweep interval, which a running timer cannot do: it captured
 * the old value when it started. The first tick after a restart is a full
 * interval away rather than the boot delay, because changing how often sweeps
 * happen is not a reason to spend one now.
 */
export function restartLiveEventsPoller(intervalMs?: number): void {
  const resolved = resolveIntervalMs(intervalMs);
  stopLiveEventsPoller();
  startLiveEventsPoller(resolved, resolved);
}

export function stopLiveEventsPoller(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
