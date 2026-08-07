import { createLogger } from "../../logger";

/** Which lane a MusicBrainz request waits in. */
export type MbPriority = "interactive" | "background";

type Waiter = { grant: () => void };

/**
 * MusicBrainz allows roughly 1 request per second. The extra 100ms absorbs
 * timer jitter so a burst of grants can't land inside the same second.
 */
const MIN_INTERVAL_MS = 1100;

/**
 * Interactive work (searches, page loads) always jumps ahead of background work
 * (pollers, profile regeneration), but only for this many grants in a row —
 * otherwise a steady stream of searches would starve the pollers forever.
 */
const MAX_CONSECUTIVE_INTERACTIVE = 8;

/** First pause after MusicBrainz throttles us; it doubles while throttling continues. */
const THROTTLE_BASE_PAUSE_MS = 2000;

const THROTTLE_MAX_PAUSE_MS = 60_000;

const log = createLogger("musicbrainz");

const lanes: Record<MbPriority, Waiter[]> = {
  interactive: [],
  background: [],
};

let pumping = false;
let consecutiveInteractive = 0;
let consecutiveThrottles = 0;
let pausedUntil = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function takeNextWaiter(): Waiter | undefined {
  if (lanes.interactive.length === 0) {
    consecutiveInteractive = 0;
    return lanes.background.shift();
  }

  if (
    lanes.background.length > 0 &&
    consecutiveInteractive >= MAX_CONSECUTIVE_INTERACTIVE
  ) {
    consecutiveInteractive = 0;
    return lanes.background.shift();
  }

  consecutiveInteractive += 1;
  return lanes.interactive.shift();
}

async function waitForResume(): Promise<void> {
  for (
    let remaining = pausedUntil - Date.now();
    remaining > 0;
    remaining = pausedUntil - Date.now()
  ) {
    await delay(remaining);
  }
}

/**
 * Grant one slot at a time, spacing each grant MIN_INTERVAL_MS apart. The delay
 * runs after the final grant too, so a request arriving just behind the last one
 * still waits out the interval instead of being released immediately.
 */
async function pump(): Promise<void> {
  pumping = true;
  try {
    for (
      let waiter = takeNextWaiter();
      waiter !== undefined;
      waiter = takeNextWaiter()
    ) {
      await waitForResume();
      waiter.grant();
      await delay(MIN_INTERVAL_MS);
    }
  } finally {
    pumping = false;
  }
}

/**
 * Wait for permission to send one MusicBrainz request. Resolves when the caller
 * may fetch; the slot is spent at that moment, so the response time of one
 * request never blocks the next.
 */
export function acquireMbSlot(
  priority: MbPriority = "interactive"
): Promise<void> {
  return new Promise<void>((resolve) => {
    lanes[priority].push({ grant: resolve });
    if (!pumping) void pump();
  });
}

/**
 * Record that MusicBrainz answered. Clears any pause, so one throttled response
 * in an otherwise healthy stream costs a single backoff rather than a spiral.
 */
export function reportMbSuccess(): void {
  consecutiveThrottles = 0;
  pausedUntil = 0;
}

/**
 * Record that MusicBrainz refused the request (429/503) and stop granting slots
 * for a while. Retrying into a service that is already shedding load is what
 * turns a brief throttle into a sustained one, so the whole queue waits — both
 * lanes, since the limit is per-client, not per-lane.
 */
export function reportMbThrottled(retryAfterSeconds?: number): void {
  consecutiveThrottles += 1;

  const backoff =
    THROTTLE_BASE_PAUSE_MS * Math.pow(2, consecutiveThrottles - 1);
  const requested = (retryAfterSeconds ?? 0) * 1000;
  const pause = Math.min(Math.max(backoff, requested), THROTTLE_MAX_PAUSE_MS);

  log.warn(
    `MusicBrainz throttled us (${consecutiveThrottles} in a row) — pausing requests for ${pause}ms`
  );
  pausedUntil = Math.max(pausedUntil, Date.now() + pause);
}

/** Number of requests currently waiting in each lane. */
export function getMbQueueDepth(): Record<MbPriority, number> {
  return {
    interactive: lanes.interactive.length,
    background: lanes.background.length,
  };
}

/** Milliseconds until the queue resumes granting slots; 0 when not paused. */
export function getMbPauseRemainingMs(): number {
  return Math.max(0, pausedUntil - Date.now());
}

/** Drop every pending waiter and reset pacing state. Test support only. */
export function resetMbQueue(): void {
  lanes.interactive = [];
  lanes.background = [];
  consecutiveInteractive = 0;
  consecutiveThrottles = 0;
  pausedUntil = 0;
}
