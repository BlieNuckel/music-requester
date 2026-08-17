import { getConfig } from "../../config";
import { JambaseError } from "../../api/jambase/config";
import { setCallRecorder, setPreflightCheck } from "../../api/jambase/fetch";
import {
  getQuotaPeriod,
  incrementQuotaCalls,
  recordWarnedThreshold,
} from "../../db/liveQuota";
import { listFollowedJambaseIds } from "../../db/liveEvents";
import { notifyQuotaWarning } from "../notifications";
import { createLogger } from "../../logger";

export type QuotaStatus = {
  period: string;
  used: number;
  quota: number;
  ratio: number;
  projectedMonthly: number;
  remainingFollowCapacity: number;
  batchSize: number;
  hardStopped: boolean;
};

const log = createLogger("live-quota");

/** 1.0 is "you are now paying"; the warn ratio is configurable. */
const HARD_THRESHOLD = 1;

let cachedStatus: QuotaStatus | null = null;

/**
 * The billing period starts on the subscription day, not the 1st, so a call on
 * the 3rd with a start day of 15 still belongs to the previous month's period.
 */
export function periodKeyFor(at: Date, startDay: number): string {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const anchored = at.getUTCDate() >= startDay ? month : month - 1;
  const shifted = new Date(Date.UTC(year, anchored, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Cost scales per batch of artists, not per artist, because `artistId` takes up
 * to 100 ids per call. That step function is what the capacity number has to
 * express: the next few follows are usually free, then one crosses a boundary.
 */
export function projectMonthlyCalls(
  rosterSize: number,
  batchSize: number,
  callsPerDayOverhead = 1
): number {
  const batches = Math.ceil(rosterSize / Math.max(1, batchSize));
  return 30 * (batches + callsPerDayOverhead);
}

export function remainingFollowCapacity(
  rosterSize: number,
  batchSize: number,
  quota: number
): number {
  let capacity = 0;
  while (
    projectMonthlyCalls(rosterSize + capacity + 1, batchSize) <= quota &&
    capacity < 100_000
  ) {
    capacity += 1;
  }
  return capacity;
}

export async function getQuotaStatus(
  at: Date = new Date()
): Promise<QuotaStatus> {
  const { liveEvents } = getConfig();
  const period = periodKeyFor(at, liveEvents.billingPeriodStartDay);
  const [usage, roster] = await Promise.all([
    getQuotaPeriod(period),
    listFollowedJambaseIds(),
  ]);

  const ratio = liveEvents.monthlyQuota
    ? usage.calls / liveEvents.monthlyQuota
    : 0;

  return {
    period,
    used: usage.calls,
    quota: liveEvents.monthlyQuota,
    ratio,
    projectedMonthly: projectMonthlyCalls(
      roster.length,
      liveEvents.rosterBatchSize
    ),
    remainingFollowCapacity: remainingFollowCapacity(
      roster.length,
      liveEvents.rosterBatchSize,
      liveEvents.monthlyQuota
    ),
    batchSize: liveEvents.rosterBatchSize,
    hardStopped: liveEvents.quotaHardStop && ratio >= HARD_THRESHOLD,
  };
}

/**
 * Usage is a condition rather than a moment, so a naive emit would fire on every
 * poll. #225 defers the other condition-shaped events for the same reason; this
 * one is tractable because the billing period gives a natural reset.
 */
async function announceCrossings(
  period: string,
  used: number,
  quota: number,
  at: string
): Promise<void> {
  const { liveEvents } = getConfig();
  const usage = await getQuotaPeriod(period);
  const ratio = quota ? used / quota : 0;

  for (const threshold of [liveEvents.quotaWarnRatio, HARD_THRESHOLD]) {
    if (ratio < threshold) continue;
    if (usage.warnedThresholds.includes(threshold)) continue;

    await recordWarnedThreshold(period, threshold, at);
    log.warn(
      `JamBase usage crossed ${Math.round(threshold * 100)}% of ${quota} (${used} calls this period)`
    );
    void notifyQuotaWarning({
      used,
      quota,
      ratio: threshold,
      hardStopped: threshold >= HARD_THRESHOLD && liveEvents.quotaHardStop,
    });
  }
}

async function record(status: number | null): Promise<void> {
  const { liveEvents } = getConfig();
  const now = new Date();
  const period = periodKeyFor(now, liveEvents.billingPeriodStartDay);

  // 4xx responses are billable too, so they count.
  await incrementQuotaCalls(period, now.toISOString());
  cachedStatus = null;

  const usage = await getQuotaPeriod(period);
  await announceCrossings(
    period,
    usage.calls,
    liveEvents.monthlyQuota,
    now.toISOString()
  );

  if (status === null) log.debug("Counted a failed request against quota");
}

async function preflight(): Promise<void> {
  const { liveEvents } = getConfig();
  if (!liveEvents.quotaHardStop) return;

  cachedStatus ??= await getQuotaStatus();
  if (cachedStatus.ratio >= HARD_THRESHOLD) {
    throw new JambaseError(
      "quota-exceeded",
      `Monthly JamBase quota of ${cachedStatus.quota} is spent; further calls would be billed`,
      null
    );
  }
}

/**
 * Wires counting and the hard stop into the client rather than into each
 * caller, so a new call site cannot forget to account for itself.
 */
export function installQuotaTracking(): void {
  setCallRecorder(({ status }) => {
    void record(status);
  });
  setPreflightCheck(preflight);
}

export function resetQuotaCache(): void {
  cachedStatus = null;
}
