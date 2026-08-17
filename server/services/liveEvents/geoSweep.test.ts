import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_LIVE_EVENTS } from "../../../shared/settingsDefaults";

const mockGetConfig = vi.fn();
const mockIsConfigured = vi.fn();
const mockSearchEvents = vi.fn();
const mockUpsert = vi.fn();
const mockApplyTombstones = vi.fn();
const mockFindKeys = vi.fn();
const mockMarkDisappeared = vi.fn();

vi.mock("../../config", () => ({
  getConfig: () => mockGetConfig(),
}));

vi.mock("../../api/jambase/config", () => ({
  isLiveEventsConfigured: () => mockIsConfigured(),
}));

vi.mock("../../api/jambase/events", () => ({
  searchEvents: (...args: unknown[]) => mockSearchEvents(...args),
  MAX_PER_PAGE: 100,
}));

vi.mock("../../db/liveEvents", () => ({
  upsertSweptEvents: (...args: unknown[]) => mockUpsert(...args),
  applyTombstones: (...args: unknown[]) => mockApplyTombstones(...args),
  findEventKeysInWindow: (...args: unknown[]) => mockFindKeys(...args),
  markDisappeared: (...args: unknown[]) => mockMarkDisappeared(...args),
}));

const { runGeoSweep, boundingBox } = await import("./geoSweep");

const MALMO = { lat: 55.605, lon: 13.0038 };

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
      originLat: MALMO.lat,
      originLon: MALMO.lon,
      ...overrides,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsConfigured.mockReturnValue(true);
  mockSearchEvents.mockResolvedValue(page());
  mockUpsert.mockResolvedValue({
    inserted: [],
    updated: [],
    statusChanged: [],
  });
  mockApplyTombstones.mockResolvedValue(0);
  mockFindKeys.mockResolvedValue([]);
  mockMarkDisappeared.mockResolvedValue(0);
  configure();
});

describe("boundingBox", () => {
  it("contains the circle it describes", () => {
    const box = boundingBox(MALMO.lat, MALMO.lon, 150);

    expect(box.maxLat - MALMO.lat).toBeCloseTo(150 / 111, 3);
    expect(box.maxLon - MALMO.lon).toBeGreaterThan(150 / 111);
  });

  it("does not blow up at the poles", () => {
    const box = boundingBox(89.999, 0, 150);
    expect(Number.isFinite(box.minLon)).toBe(true);
    expect(Number.isFinite(box.maxLon)).toBe(true);
  });
});

describe("guards", () => {
  it("does nothing when unconfigured", async () => {
    mockIsConfigured.mockReturnValue(false);
    expect((await runGeoSweep()).ran).toBe(false);
    expect(mockSearchEvents).not.toHaveBeenCalled();
  });

  it("does nothing without a sweep origin", async () => {
    configure({ originLat: null, originLon: null });
    expect((await runGeoSweep()).ran).toBe(false);
    expect(mockSearchEvents).not.toHaveBeenCalled();
  });
});

describe("sweeping", () => {
  it("queries the configured radius and horizon", async () => {
    configure({ sweepRadiusKm: 150, shelfHorizonDays: 28 });
    await runGeoSweep();

    const params = mockSearchEvents.mock.calls[0][0] as Record<string, unknown>;
    expect(params.latitude).toBe(MALMO.lat);
    expect(params.radiusKm).toBe(150);

    const days = Math.round(
      (Date.parse(params.dateTo as string) -
        Date.parse(params.dateFrom as string)) /
        86_400_000
    );
    expect(days).toBe(28);
  });

  it("never sends a delta watermark, since this is a full refresh", async () => {
    await runGeoSweep();
    const params = mockSearchEvents.mock.calls[0][0] as Record<string, unknown>;
    expect(params.dateModifiedFrom).toBeUndefined();
  });

  it("walks every page and upserts each", async () => {
    mockSearchEvents.mockResolvedValue(
      page({ totalPages: 3, events: [{ event_key: "jambase:1" }] })
    );

    const result = await runGeoSweep();

    expect(result.pages).toBe(3);
    expect(result.events).toBe(3);
    expect(mockUpsert).toHaveBeenCalledTimes(3);
  });

  it("applies tombstones as they arrive", async () => {
    mockSearchEvents.mockResolvedValue(
      page({ tombstones: [{ event_key: "jambase:9" }] })
    );

    expect((await runGeoSweep()).tombstones).toBe(1);
    expect(mockApplyTombstones).toHaveBeenCalled();
  });
});

describe("reconciliation", () => {
  it("marks a stored event the sweep no longer sees", async () => {
    mockSearchEvents.mockResolvedValue(
      page({ events: [{ event_key: "jambase:1" }] })
    );
    mockFindKeys.mockResolvedValue(["jambase:1", "jambase:2"]);
    mockMarkDisappeared.mockResolvedValue(1);

    const result = await runGeoSweep();

    expect(result.disappeared).toBe(1);
    expect(mockMarkDisappeared).toHaveBeenCalledWith(
      ["jambase:2"],
      expect.any(String)
    );
  });

  it("scopes reconciliation to the box and window it actually enumerated", async () => {
    configure({ sweepRadiusKm: 150 });
    await runGeoSweep();

    const [window, bounds] = mockFindKeys.mock.calls[0] as [
      { from: string; to: string },
      Record<string, number>,
    ];
    expect(window.from).toBeDefined();
    expect(bounds.minLat).toBeLessThan(MALMO.lat);
    expect(bounds.maxLat).toBeGreaterThan(MALMO.lat);
  });

  it("does not reconcile when the page cap cut the sweep short", async () => {
    configure({ maxPagesPerRun: 2 });
    mockSearchEvents.mockResolvedValue(page({ totalPages: 9 }));

    const result = await runGeoSweep();

    expect(result.hitPageCap).toBe(true);
    expect(result.completed).toBe(false);
    expect(mockFindKeys).not.toHaveBeenCalled();
    expect(mockMarkDisappeared).not.toHaveBeenCalled();
  });

  it("does not reconcile when a page request throws", async () => {
    mockSearchEvents.mockRejectedValue(new Error("503"));

    await expect(runGeoSweep()).rejects.toThrow("503");
    expect(mockMarkDisappeared).not.toHaveBeenCalled();
  });

  it("skips the write when nothing disappeared", async () => {
    mockSearchEvents.mockResolvedValue(
      page({ events: [{ event_key: "jambase:1" }] })
    );
    mockFindKeys.mockResolvedValue(["jambase:1"]);

    expect((await runGeoSweep()).disappeared).toBe(0);
    expect(mockMarkDisappeared).not.toHaveBeenCalled();
  });
});
