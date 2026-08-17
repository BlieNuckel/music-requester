import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_LIVE_EVENTS } from "../../../shared/settingsDefaults";

const mockGetConfig = vi.fn();
const mockSetConfig = vi.fn();
const mockIsConfigured = vi.fn();
const mockSearchEvents = vi.fn();
const mockListIds = vi.fn();
const mockListRegions = vi.fn();
const mockUpsert = vi.fn();
const mockApplyTombstones = vi.fn();

vi.mock("../../config", () => ({
  getConfig: () => mockGetConfig(),
  setConfig: (...args: unknown[]) => mockSetConfig(...args),
}));

vi.mock("../../api/jambase/config", () => ({
  isLiveEventsConfigured: () => mockIsConfigured(),
}));

vi.mock("../../api/jambase/events", () => ({
  searchEvents: (...args: unknown[]) => mockSearchEvents(...args),
  MAX_PER_PAGE: 100,
}));

vi.mock("../../db/liveEvents", () => ({
  listFollowedJambaseIds: () => mockListIds(),
  listLiveRegionsUnion: () => mockListRegions(),
  upsertSweptEvents: (...args: unknown[]) => mockUpsert(...args),
  applyTombstones: (...args: unknown[]) => mockApplyTombstones(...args),
}));

const { runRosterSweep } = await import("./rosterSweep");

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `jambase:${i + 1}`);
}

function page(overrides: Record<string, unknown> = {}) {
  return {
    events: [],
    tombstones: [],
    skipped: 0,
    page: 1,
    perPage: 100,
    totalItems: 0,
    totalPages: 1,
    ...overrides,
  };
}

function configure(overrides: Record<string, unknown> = {}) {
  mockGetConfig.mockReturnValue({
    liveEvents: {
      ...DEFAULT_LIVE_EVENTS,
      enabled: true,
      apiKey: "k",
      ...overrides,
    },
  });
}

function callParams(index: number): Record<string, unknown> {
  return mockSearchEvents.mock.calls[index][0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsConfigured.mockReturnValue(true);
  mockListIds.mockResolvedValue(ids(3));
  mockListRegions.mockResolvedValue(["SE", "DK"]);
  mockSearchEvents.mockResolvedValue(page());
  mockUpsert.mockResolvedValue({
    inserted: [],
    updated: [],
    statusChanged: [],
  });
  mockApplyTombstones.mockResolvedValue(0);
  configure();
});

describe("guards", () => {
  it("does nothing when unconfigured", async () => {
    mockIsConfigured.mockReturnValue(false);
    const result = await runRosterSweep();

    expect(result.ran).toBe(false);
    expect(mockSearchEvents).not.toHaveBeenCalled();
  });

  it("does nothing when no artist has been resolved yet", async () => {
    mockListIds.mockResolvedValue([]);
    const result = await runRosterSweep();

    expect(result.ran).toBe(false);
    expect(mockSearchEvents).not.toHaveBeenCalled();
  });
});

describe("batching", () => {
  it("splits the roster into batches of rosterBatchSize", async () => {
    mockListIds.mockResolvedValue(ids(250));
    configure({
      rosterBatchSize: 100,
      rosterWatermark: "2026-08-01 00:00:00",
      rosterFullSweptAt: new Date().toISOString(),
    });

    const result = await runRosterSweep();

    expect(result.batches).toBe(3);
    expect(mockSearchEvents).toHaveBeenCalledTimes(3);
    expect((callParams(0).artistIds as string[]).length).toBe(100);
    expect((callParams(2).artistIds as string[]).length).toBe(50);
  });

  it("sends the union of user regions, not one user's", async () => {
    mockListRegions.mockResolvedValue(["SE", "DK", "DE"]);
    await runRosterSweep();
    expect(callParams(0).countries).toEqual(["SE", "DK", "DE"]);
  });

  it("falls back to the configured regions when no user has chosen any", async () => {
    mockListRegions.mockResolvedValue([]);
    configure({ regions: ["SE"] });

    await runRosterSweep();
    expect(callParams(0).countries).toEqual(["SE"]);
  });

  it("bounds the request to the tier's horizon", async () => {
    configure({ bannerHorizonDays: 180 });
    await runRosterSweep();

    const from = new Date(callParams(0).dateFrom as string);
    const to = new Date(callParams(0).dateTo as string);
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    expect(days).toBe(180);
  });
});

describe("pagination", () => {
  it("walks every page of a batch", async () => {
    mockListIds.mockResolvedValue(ids(1));
    mockSearchEvents.mockResolvedValue(page({ totalPages: 3 }));

    const result = await runRosterSweep();

    expect(result.pages).toBe(3);
    expect(callParams(0).page).toBe(1);
    expect(callParams(2).page).toBe(3);
  });

  it("upserts events and applies tombstones from each page", async () => {
    mockListIds.mockResolvedValue(ids(1));
    mockSearchEvents.mockResolvedValue(
      page({
        events: [{ event_key: "jambase:100" }],
        tombstones: [{ event_key: "jambase:200" }],
      })
    );

    const result = await runRosterSweep();

    expect(result.events).toBe(1);
    expect(result.tombstones).toBe(1);
    expect(mockUpsert).toHaveBeenCalled();
    expect(mockApplyTombstones).toHaveBeenCalled();
  });
});

describe("delta vs full pass", () => {
  it("runs a full pass when there is no watermark", async () => {
    configure({ rosterWatermark: null });
    const result = await runRosterSweep();

    expect(result.isFullPass).toBe(true);
    expect(callParams(0).dateModifiedFrom).toBeUndefined();
  });

  it("sends the watermark once one exists", async () => {
    configure({
      rosterWatermark: "2026-08-10 00:00:00",
      rosterFullSweptAt: new Date().toISOString(),
    });

    const result = await runRosterSweep();

    expect(result.isFullPass).toBe(false);
    expect(callParams(0).dateModifiedFrom).toBe("2026-08-10 00:00:00");
  });

  it("forces a full pass once the reconciliation interval has elapsed", async () => {
    const longAgo = new Date(Date.now() - 40 * 86_400_000).toISOString();
    configure({
      rosterWatermark: "2026-08-10 00:00:00",
      rosterFullSweptAt: longAgo,
      fullSweepIntervalDays: 30,
    });

    const result = await runRosterSweep();

    expect(result.isFullPass).toBe(true);
    expect(callParams(0).dateModifiedFrom).toBeUndefined();
  });

  it("treats an unparseable rosterFullSweptAt as due", async () => {
    configure({
      rosterWatermark: "2026-08-10 00:00:00",
      rosterFullSweptAt: "not a date",
    });
    expect((await runRosterSweep()).isFullPass).toBe(true);
  });
});

describe("watermark advancement", () => {
  it("advances only on a clean run, padded backwards", async () => {
    configure({
      rosterWatermark: "2026-08-10 00:00:00",
      rosterFullSweptAt: new Date().toISOString(),
    });

    const result = await runRosterSweep();

    expect(result.completed).toBe(true);
    const patch = mockSetConfig.mock.calls[0][0] as {
      liveEvents: { rosterWatermark: string };
    };
    expect(patch.liveEvents.rosterWatermark).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
    );
    expect(
      Date.now() -
        Date.parse(patch.liveEvents.rosterWatermark.replace(" ", "T") + "Z")
    ).toBeGreaterThanOrEqual(5 * 60 * 1000 - 1000);
  });

  it("records the full-pass timestamp only on a full pass", async () => {
    configure({ rosterWatermark: null });
    await runRosterSweep();

    const patch = mockSetConfig.mock.calls[0][0] as {
      liveEvents: Record<string, unknown>;
    };
    expect(patch.liveEvents.rosterFullSweptAt).toEqual(expect.any(String));
  });

  it("does not advance the watermark when the page cap is hit", async () => {
    mockListIds.mockResolvedValue(ids(1));
    configure({
      maxPagesPerRun: 2,
      rosterWatermark: "2026-08-10 00:00:00",
      rosterFullSweptAt: new Date().toISOString(),
    });
    mockSearchEvents.mockResolvedValue(page({ totalPages: 9 }));

    const result = await runRosterSweep();

    expect(result.hitPageCap).toBe(true);
    expect(result.completed).toBe(false);
    expect(result.pages).toBe(2);
    expect(mockSetConfig).not.toHaveBeenCalled();
  });

  it("stops starting new batches once the budget is gone", async () => {
    mockListIds.mockResolvedValue(ids(300));
    configure({
      rosterBatchSize: 100,
      maxPagesPerRun: 2,
      rosterWatermark: "2026-08-10 00:00:00",
      rosterFullSweptAt: new Date().toISOString(),
    });

    const result = await runRosterSweep();

    expect(result.pages).toBe(2);
    expect(result.completed).toBe(false);
    expect(mockSetConfig).not.toHaveBeenCalled();
  });

  it("lets a failure propagate without moving the watermark", async () => {
    configure({
      rosterWatermark: "2026-08-10 00:00:00",
      rosterFullSweptAt: new Date().toISOString(),
    });
    mockSearchEvents.mockRejectedValue(new Error("503"));

    await expect(runRosterSweep()).rejects.toThrow("503");
    expect(mockSetConfig).not.toHaveBeenCalled();
  });
});
