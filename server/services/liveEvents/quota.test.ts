import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_LIVE_EVENTS } from "../../../shared/settingsDefaults";

const mockGetConfig = vi.fn();
const mockGetPeriod = vi.fn();
const mockIncrement = vi.fn();
const mockRecordWarned = vi.fn();
const mockListRoster = vi.fn();
const mockNotify = vi.fn();
const mockSetCallRecorder = vi.fn();
const mockSetPreflight = vi.fn();

vi.mock("../../config", () => ({
  getConfig: () => mockGetConfig(),
}));

vi.mock("../../db/liveQuota", () => ({
  getQuotaPeriod: (...args: unknown[]) => mockGetPeriod(...args),
  incrementQuotaCalls: (...args: unknown[]) => mockIncrement(...args),
  recordWarnedThreshold: (...args: unknown[]) => mockRecordWarned(...args),
}));

vi.mock("../../db/liveEvents", () => ({
  listFollowedJambaseIds: () => mockListRoster(),
}));

vi.mock("../notifications", () => ({
  notifyQuotaWarning: (...args: unknown[]) => mockNotify(...args),
}));

vi.mock("../../api/jambase/fetch", () => ({
  setCallRecorder: (...args: unknown[]) => mockSetCallRecorder(...args),
  setPreflightCheck: (...args: unknown[]) => mockSetPreflight(...args),
}));

const {
  periodKeyFor,
  projectMonthlyCalls,
  remainingFollowCapacity,
  getQuotaStatus,
  installQuotaTracking,
  resetQuotaCache,
} = await import("./quota");
const { JambaseError } = await import("../../api/jambase/config");

function configure(overrides: Record<string, unknown> = {}) {
  mockGetConfig.mockReturnValue({
    liveEvents: {
      ...DEFAULT_LIVE_EVENTS,
      enabled: true,
      apiKey: "k",
      monthlyQuota: 1000,
      quotaWarnRatio: 0.8,
      quotaHardStop: true,
      rosterBatchSize: 100,
      ...overrides,
    },
  });
}

function roster(size: number): string[] {
  return Array.from({ length: size }, (_, i) => `jambase:${i}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetQuotaCache();
  configure();
  mockGetPeriod.mockResolvedValue({
    period: "2026-08",
    calls: 0,
    warnedThresholds: [],
  });
  mockIncrement.mockResolvedValue(undefined);
  mockRecordWarned.mockResolvedValue(undefined);
  mockListRoster.mockResolvedValue([]);
});

describe("periodKeyFor", () => {
  it("uses calendar months when billing starts on the 1st", () => {
    expect(periodKeyFor(new Date("2026-08-17T00:00:00Z"), 1)).toBe("2026-08");
  });

  it("anchors on the subscription day rather than the 1st", () => {
    expect(periodKeyFor(new Date("2026-08-03T00:00:00Z"), 15)).toBe("2026-07");
    expect(periodKeyFor(new Date("2026-08-20T00:00:00Z"), 15)).toBe("2026-08");
  });

  it("rolls back across a year boundary", () => {
    expect(periodKeyFor(new Date("2026-01-05T00:00:00Z"), 15)).toBe("2025-12");
  });
});

describe("projectMonthlyCalls", () => {
  it("steps per batch of 100 artists, not per artist", () => {
    expect(projectMonthlyCalls(300, 100)).toBe(120);
    expect(projectMonthlyCalls(301, 100)).toBe(150);
    expect(projectMonthlyCalls(400, 100)).toBe(150);
  });

  it("matches the numbers the spike projected", () => {
    expect(projectMonthlyCalls(1000, 100)).toBe(330);
    expect(projectMonthlyCalls(2000, 100)).toBe(630);
    expect(projectMonthlyCalls(2900, 100)).toBe(900);
  });

  it("counts the daily geo sweep even with nobody followed", () => {
    expect(projectMonthlyCalls(0, 100)).toBe(30);
  });
});

describe("remainingFollowCapacity", () => {
  it("reports how many more follows fit before the quota is crossed", () => {
    // 3,200 artists is 32 batches, 30 x 33 = 990 calls. One more crosses it.
    expect(remainingFollowCapacity(2800, 100, 1000)).toBe(400);
    expect(projectMonthlyCalls(3200, 100)).toBeLessThanOrEqual(1000);
    expect(projectMonthlyCalls(3201, 100)).toBeGreaterThan(1000);
  });

  it("returns zero once a roster is already over", () => {
    expect(remainingFollowCapacity(5000, 100, 1000)).toBe(0);
  });

  it("has plenty of room for a small roster", () => {
    expect(remainingFollowCapacity(50, 100, 1000)).toBeGreaterThan(1000);
  });
});

describe("getQuotaStatus", () => {
  it("reports usage against the plan allowance", async () => {
    mockGetPeriod.mockResolvedValue({
      period: "2026-08",
      calls: 850,
      warnedThresholds: [],
    });
    mockListRoster.mockResolvedValue(roster(300));

    const status = await getQuotaStatus(new Date("2026-08-17T00:00:00Z"));

    expect(status.used).toBe(850);
    expect(status.quota).toBe(1000);
    expect(status.ratio).toBeCloseTo(0.85);
    expect(status.projectedMonthly).toBe(120);
  });

  it("flags a hard stop only once the allowance is fully spent", async () => {
    mockGetPeriod.mockResolvedValue({
      period: "2026-08",
      calls: 999,
      warnedThresholds: [],
    });
    expect((await getQuotaStatus()).hardStopped).toBe(false);

    mockGetPeriod.mockResolvedValue({
      period: "2026-08",
      calls: 1000,
      warnedThresholds: [],
    });
    expect((await getQuotaStatus()).hardStopped).toBe(true);
  });

  it("never hard stops when the setting is off", async () => {
    configure({ quotaHardStop: false });
    mockGetPeriod.mockResolvedValue({
      period: "2026-08",
      calls: 5000,
      warnedThresholds: [],
    });

    expect((await getQuotaStatus()).hardStopped).toBe(false);
  });
});

describe("counting and warning", () => {
  function recorder() {
    installQuotaTracking();
    return mockSetCallRecorder.mock.calls[0][0] as (info: {
      status: number | null;
    }) => void;
  }

  it("counts a successful call", async () => {
    const record = recorder();
    record({ status: 200 });
    await vi.waitFor(() => expect(mockIncrement).toHaveBeenCalled());
  });

  it("counts a 4xx, since those are billable too", async () => {
    const record = recorder();
    record({ status: 403 });
    await vi.waitFor(() => expect(mockIncrement).toHaveBeenCalled());
  });

  it("counts a request that never got a response", async () => {
    const record = recorder();
    record({ status: null });
    await vi.waitFor(() => expect(mockIncrement).toHaveBeenCalled());
  });

  it("announces the warn threshold once it is crossed", async () => {
    mockGetPeriod.mockResolvedValue({
      period: "2026-08",
      calls: 801,
      warnedThresholds: [],
    });

    const record = recorder();
    record({ status: 200 });

    await vi.waitFor(() => expect(mockNotify).toHaveBeenCalled());
    expect(mockNotify.mock.calls[0][0]).toMatchObject({ ratio: 0.8 });
    expect(mockRecordWarned).toHaveBeenCalledWith(
      "2026-08",
      0.8,
      expect.any(String)
    );
  });

  it("stays quiet about a threshold already announced this period", async () => {
    mockGetPeriod.mockResolvedValue({
      period: "2026-08",
      calls: 900,
      warnedThresholds: [0.8],
    });

    const record = recorder();
    record({ status: 200 });

    await vi.waitFor(() => expect(mockIncrement).toHaveBeenCalled());
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("announces the full-quota crossing separately", async () => {
    mockGetPeriod.mockResolvedValue({
      period: "2026-08",
      calls: 1000,
      warnedThresholds: [0.8],
    });

    const record = recorder();
    record({ status: 200 });

    await vi.waitFor(() => expect(mockNotify).toHaveBeenCalled());
    expect(mockNotify.mock.calls[0][0]).toMatchObject({
      ratio: 1,
      hardStopped: true,
    });
  });
});

describe("hard stop", () => {
  function preflight() {
    installQuotaTracking();
    return mockSetPreflight.mock.calls[0][0] as () => Promise<void>;
  }

  it("blocks a call once the allowance is spent", async () => {
    mockGetPeriod.mockResolvedValue({
      period: "2026-08",
      calls: 1000,
      warnedThresholds: [],
    });

    await expect(preflight()()).rejects.toMatchObject({
      kind: "quota-exceeded",
    });
  });

  it("allows a call below the allowance", async () => {
    mockGetPeriod.mockResolvedValue({
      period: "2026-08",
      calls: 500,
      warnedThresholds: [],
    });

    await expect(preflight()()).resolves.toBeUndefined();
  });

  it("does nothing when the hard stop is disabled", async () => {
    configure({ quotaHardStop: false });
    mockGetPeriod.mockResolvedValue({
      period: "2026-08",
      calls: 99999,
      warnedThresholds: [],
    });

    await expect(preflight()()).resolves.toBeUndefined();
  });

  it("throws a JambaseError so callers classify it like any other refusal", async () => {
    mockGetPeriod.mockResolvedValue({
      period: "2026-08",
      calls: 1000,
      warnedThresholds: [],
    });

    await expect(preflight()()).rejects.toBeInstanceOf(JambaseError);
  });
});
