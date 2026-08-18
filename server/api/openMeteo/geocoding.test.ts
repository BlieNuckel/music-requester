import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResilientFetch = vi.fn();

vi.mock("../resilientFetch", () => ({
  resilientFetch: (...args: unknown[]) => mockResilientFetch(...args),
}));

vi.mock("../../logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { searchPlaces } = await import("./geocoding");

function respond(body: unknown, ok = true, status = 200) {
  mockResilientFetch.mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
}

const MALMO = {
  name: "Malmö",
  latitude: 55.60587,
  longitude: 13.00073,
  country: "Sweden",
  country_code: "SE",
  admin1: "Skåne County",
  population: 362133,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchPlaces", () => {
  it("maps a hit to the fields a picker needs", async () => {
    respond({ results: [MALMO] });

    expect(await searchPlaces("Malmö")).toEqual([
      {
        name: "Malmö",
        region: "Skåne County",
        country: "Sweden",
        countryCode: "SE",
        latitude: 55.60587,
        longitude: 13.00073,
        population: 362133,
      },
    ]);
  });

  it("asks for English names and a bounded count", async () => {
    respond({ results: [] });
    await searchPlaces("Copenhagen", 3);

    const url = String(mockResilientFetch.mock.calls[0][0]);
    expect(url).toContain("name=Copenhagen");
    expect(url).toContain("count=3");
    expect(url).toContain("language=en");
  });

  it("treats a body with no results key as no matches", async () => {
    respond({ generationtime_ms: 0.4 });
    expect(await searchPlaces("Nowherecity")).toEqual([]);
  });

  it("drops a hit with no coordinates rather than returning NaN", async () => {
    respond({ results: [{ name: "Somewhere" }, MALMO] });

    const places = await searchPlaces("Somewhere");
    expect(places).toHaveLength(1);
    expect(places[0].name).toBe("Malmö");
  });

  it("fills in the optional fields that the index can omit", async () => {
    respond({ results: [{ name: "X", latitude: 1, longitude: 2 }] });

    expect(await searchPlaces("X marks")).toEqual([
      {
        name: "X",
        region: null,
        country: "",
        countryCode: "",
        latitude: 1,
        longitude: 2,
        population: null,
      },
    ]);
  });

  it("does not call out for a query too short to mean anything", async () => {
    expect(await searchPlaces("m")).toEqual([]);
    expect(mockResilientFetch).not.toHaveBeenCalled();
  });

  it("returns nothing on a non-ok response", async () => {
    respond({}, false, 503);
    expect(await searchPlaces("Bergen")).toEqual([]);
  });

  it("returns nothing when the lookup throws", async () => {
    mockResilientFetch.mockRejectedValue(new Error("network"));
    expect(await searchPlaces("Oslo")).toEqual([]);
  });

  it("caches a lookup, case-insensitively", async () => {
    respond({ results: [MALMO] });

    await searchPlaces("Gothenburg");
    await searchPlaces("gothenburg");

    expect(mockResilientFetch).toHaveBeenCalledTimes(1);
  });
});
