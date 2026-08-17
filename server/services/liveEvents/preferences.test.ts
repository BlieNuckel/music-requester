import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_LIVE_EVENTS } from "../../../shared/settingsDefaults";

const mockGetConfig = vi.fn();
const mockGetPrefs = vi.fn();
const mockSetPrefs = vi.fn();

vi.mock("../../config", () => ({
  getConfig: () => mockGetConfig(),
}));

vi.mock("../../db/liveEvents", async () => {
  const actual = await vi.importActual<typeof import("../../db/liveEvents")>(
    "../../db/liveEvents"
  );
  return {
    distanceKm: actual.distanceKm,
    getUserLivePreferences: (...args: unknown[]) => mockGetPrefs(...args),
    setUserLivePreferences: (...args: unknown[]) => mockSetPrefs(...args),
  };
});

const { getCoverage, readLivePreferences, writeLivePreferences } =
  await import("./preferences");

const MALMO = { lat: 55.605, lon: 13.0038 };
const COPENHAGEN = { lat: 55.6761, lon: 12.5683 };
const BERLIN = { lat: 52.52, lon: 13.405 };

const EMPTY_PREFS = {
  live_radius_km: null,
  live_lat: null,
  live_lon: null,
  live_regions: null,
  live_announce_days: null,
  live_imminent_days_local: null,
  live_imminent_days_regional: null,
  live_banner_enabled: null,
};

function configure(overrides: Record<string, unknown> = {}) {
  mockGetConfig.mockReturnValue({
    liveEvents: {
      ...DEFAULT_LIVE_EVENTS,
      enabled: true,
      apiKey: "k",
      originLat: MALMO.lat,
      originLon: MALMO.lon,
      sweepRadiusKm: 150,
      regions: ["SE", "DK"],
      ...overrides,
    },
  });
}

function lastPatch(): Record<string, unknown> {
  const calls = mockSetPrefs.mock.calls;
  return calls[calls.length - 1][1] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  configure();
  mockGetPrefs.mockResolvedValue(EMPTY_PREFS);
  mockSetPrefs.mockResolvedValue(undefined);
});

describe("getCoverage", () => {
  it("reports what the instance can see", () => {
    expect(getCoverage()).toEqual({
      originLat: MALMO.lat,
      originLon: MALMO.lon,
      sweepRadiusKm: 150,
      regions: ["SE", "DK"],
      configured: true,
    });
  });

  it("is unconfigured without an origin or a key", () => {
    configure({ originLat: null, originLon: null });
    expect(getCoverage().configured).toBe(false);

    configure({ apiKey: "" });
    expect(getCoverage().configured).toBe(false);
  });
});

describe("readLivePreferences", () => {
  it("returns preferences alongside the coverage disclosure", async () => {
    const view = await readLivePreferences(1);
    expect(view.preferences).toEqual(EMPTY_PREFS);
    expect(view.coverage.sweepRadiusKm).toBe(150);
  });

  it("404s for an unknown user", async () => {
    mockGetPrefs.mockResolvedValue(null);
    await expect(readLivePreferences(999)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("radius clamping", () => {
  it("clamps to what the instance sweeps rather than rejecting", async () => {
    await writeLivePreferences(1, { radiusKm: 900 });
    expect(lastPatch().live_radius_km).toBe(150);
  });

  it("keeps a radius inside coverage", async () => {
    await writeLivePreferences(1, { radiusKm: 40 });
    expect(lastPatch().live_radius_km).toBe(40);
  });

  it("floors at 1 rather than accepting zero", async () => {
    await writeLivePreferences(1, { radiusKm: 0 });
    expect(lastPatch().live_radius_km).toBe(1);
  });

  it("passes null through to mean inherit", async () => {
    await writeLivePreferences(1, { radiusKm: null });
    expect(lastPatch().live_radius_km).toBeNull();
  });
});

describe("home location validation", () => {
  it("accepts a point inside the swept area", async () => {
    await expect(
      writeLivePreferences(1, { lat: COPENHAGEN.lat, lon: COPENHAGEN.lon })
    ).resolves.toBeDefined();
  });

  it("rejects a point the instance will never fetch, and says how far off it is", async () => {
    await expect(
      writeLivePreferences(1, { lat: BERLIN.lat, lon: BERLIN.lon })
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("km from what this instance covers"),
    });
    expect(mockSetPrefs).not.toHaveBeenCalled();
  });

  it("rejects an impossible coordinate", async () => {
    await expect(
      writeLivePreferences(1, { lat: 91, lon: 0 })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("cannot judge a location when the instance has no origin", async () => {
    configure({ originLat: null, originLon: null });
    await expect(
      writeLivePreferences(1, { lat: BERLIN.lat, lon: BERLIN.lon })
    ).resolves.toBeDefined();
  });
});

describe("region validation", () => {
  it("accepts alpha-2 codes", async () => {
    await writeLivePreferences(1, { regions: ["SE", "DE"] });
    expect(lastPatch().live_regions).toEqual(["SE", "DE"]);
  });

  it("rejects UK in favour of GB", async () => {
    await expect(
      writeLivePreferences(1, { regions: ["UK"] })
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("GB"),
    });
  });

  it("rejects anything that is not a two-letter code", async () => {
    await expect(
      writeLivePreferences(1, { regions: ["SWE"] })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("day windows", () => {
  it("rejects zero and fractional days", async () => {
    await expect(
      writeLivePreferences(1, { announceDays: 0 })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      writeLivePreferences(1, { imminentDaysLocal: 1.5 })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("accepts a positive number of days", async () => {
    await writeLivePreferences(1, {
      announceDays: 7,
      imminentDaysRegional: 60,
    });
    expect(lastPatch().live_announce_days).toBe(7);
    expect(lastPatch().live_imminent_days_regional).toBe(60);
  });
});

describe("partial patches", () => {
  it("only writes the fields it was given", async () => {
    await writeLivePreferences(1, { bannerEnabled: false });
    expect(lastPatch()).toEqual({ live_banner_enabled: false });
  });

  it("writes nothing for an empty patch", async () => {
    await writeLivePreferences(1, {});
    expect(lastPatch()).toEqual({});
  });
});
