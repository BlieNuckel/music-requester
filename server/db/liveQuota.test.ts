import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initializeDatabase, getDataSource, closeDatabase } from "./index";
import {
  getQuotaPeriod,
  incrementQuotaCalls,
  recordWarnedThreshold,
  listRecentPeriods,
} from "./liveQuota";

const AT = "2026-08-17T09:00:00.000Z";

beforeEach(async () => {
  await initializeDatabase(":memory:");
});

afterEach(async () => {
  await closeDatabase();
});

describe("getQuotaPeriod", () => {
  it("reports an unused period as zero rather than missing", async () => {
    expect(await getQuotaPeriod("2026-08")).toEqual({
      period: "2026-08",
      calls: 0,
      warnedThresholds: [],
    });
  });
});

describe("incrementQuotaCalls", () => {
  it("creates the period on first use", async () => {
    await incrementQuotaCalls("2026-08", AT);
    expect((await getQuotaPeriod("2026-08")).calls).toBe(1);
  });

  it("accumulates without losing increments", async () => {
    for (let i = 0; i < 25; i += 1) {
      await incrementQuotaCalls("2026-08", AT);
    }
    expect((await getQuotaPeriod("2026-08")).calls).toBe(25);
  });

  it("survives concurrent increments, which a read-modify-write would not", async () => {
    await Promise.all(
      Array.from({ length: 20 }, () => incrementQuotaCalls("2026-08", AT))
    );
    expect((await getQuotaPeriod("2026-08")).calls).toBe(20);
  });

  it("keeps periods separate", async () => {
    await incrementQuotaCalls("2026-08", AT);
    await incrementQuotaCalls("2026-09", AT);

    expect((await getQuotaPeriod("2026-08")).calls).toBe(1);
    expect((await getQuotaPeriod("2026-09")).calls).toBe(1);
  });
});

describe("recordWarnedThreshold", () => {
  it("remembers a threshold across restarts", async () => {
    await recordWarnedThreshold("2026-08", 0.8, AT);
    expect((await getQuotaPeriod("2026-08")).warnedThresholds).toEqual([0.8]);
  });

  it("does not duplicate a threshold already recorded", async () => {
    await recordWarnedThreshold("2026-08", 0.8, AT);
    await recordWarnedThreshold("2026-08", 0.8, AT);
    expect((await getQuotaPeriod("2026-08")).warnedThresholds).toEqual([0.8]);
  });

  it("accumulates distinct thresholds", async () => {
    await recordWarnedThreshold("2026-08", 0.8, AT);
    await recordWarnedThreshold("2026-08", 1, AT);
    expect((await getQuotaPeriod("2026-08")).warnedThresholds).toEqual([
      0.8, 1,
    ]);
  });

  it("does not disturb the call count", async () => {
    await incrementQuotaCalls("2026-08", AT);
    await recordWarnedThreshold("2026-08", 0.8, AT);
    expect((await getQuotaPeriod("2026-08")).calls).toBe(1);
  });

  it("starts a new period at zero calls when warned before any call", async () => {
    await recordWarnedThreshold("2026-08", 0.8, AT);
    expect((await getQuotaPeriod("2026-08")).calls).toBe(0);
  });

  it("tolerates a corrupt thresholds blob", async () => {
    await incrementQuotaCalls("2026-08", AT);
    await getDataSource().query(
      "UPDATE live_quota_usage SET warned_thresholds = 'not json'"
    );
    expect((await getQuotaPeriod("2026-08")).warnedThresholds).toEqual([]);
  });
});

describe("listRecentPeriods", () => {
  it("returns newest first", async () => {
    await incrementQuotaCalls("2026-07", AT);
    await incrementQuotaCalls("2026-08", AT);
    await incrementQuotaCalls("2026-09", AT);

    expect((await listRecentPeriods()).map((p) => p.period)).toEqual([
      "2026-09",
      "2026-08",
      "2026-07",
    ]);
  });

  it("respects the limit", async () => {
    await incrementQuotaCalls("2026-07", AT);
    await incrementQuotaCalls("2026-08", AT);
    expect(await listRecentPeriods(1)).toHaveLength(1);
  });
});
