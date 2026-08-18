import { getConfig } from "../../config";
import { isLiveEventsConfigured } from "../../api/jambase/config";
import { createLogger } from "../../logger";
import { restartLiveEventsPoller, runLivePollOnce } from "./poller";

/**
 * The parts of the live events settings a save can change that the poller cares
 * about. Captured before the write so the handler can compare the two states
 * rather than guess from the partial body.
 */
export type LiveEventsSettingsSnapshot = {
  configured: boolean;
  hasOrigin: boolean;
  sweepIntervalHours: number;
};

const log = createLogger("live-settings");

/**
 * A sweep is many JamBase calls, and past the free allowance each one bills.
 * Toggling the integration off and on again must not buy a sweep per toggle.
 */
const MIN_KICK_INTERVAL_MS = 5 * 60 * 1000;

let lastKickAt = 0;

export function snapshotLiveEventsSettings(): LiveEventsSettingsSnapshot {
  const { liveEvents } = getConfig();
  return {
    configured: isLiveEventsConfigured(),
    hasOrigin: liveEvents.originLat !== null && liveEvents.originLon !== null,
    sweepIntervalHours: liveEvents.sweepIntervalHours,
  };
}

/** Clear the kick throttle so a test can start from a known state. */
export function resetLiveEventsKickThrottle(): void {
  lastKickAt = 0;
}

/**
 * Whether this save is what made live events able to return anything. Both
 * transitions matter: without a key nothing runs at all, and the geo sweep bails
 * on a null origin, so filling in coordinates is equally load-bearing.
 */
function becameUsable(
  before: LiveEventsSettingsSnapshot,
  after: LiveEventsSettingsSnapshot
): boolean {
  if (!after.configured) return false;
  return !before.configured || (!before.hasOrigin && after.hasOrigin);
}

/**
 * React to a live events settings write. The poller is otherwise blind to
 * configuration: its first tick is boot + 45s, and an unconfigured tick books
 * the next attempt a full sweep interval away, so entering an API key used to
 * look like nothing happening for up to a day.
 *
 * Deliberately not awaited by the caller — a roster sweep is many sequential
 * calls and the HTTP response should not wait for it.
 */
export function onLiveEventsSettingsSaved(
  before: LiveEventsSettingsSnapshot
): void {
  const after = snapshotLiveEventsSettings();

  if (after.sweepIntervalHours !== before.sweepIntervalHours) {
    log.info(
      `Sweep interval changed to ${after.sweepIntervalHours}h, restarting poller`
    );
    restartLiveEventsPoller();
  }

  if (!becameUsable(before, after)) return;

  const now = Date.now();
  if (now - lastKickAt < MIN_KICK_INTERVAL_MS) {
    log.info("Live sweep already kicked recently, skipping this one");
    return;
  }
  lastKickAt = now;

  log.info("Live events became usable, sweeping now");
  void runLivePollOnce().catch((error) =>
    log.error("Kicked live poll failed", error)
  );
}
