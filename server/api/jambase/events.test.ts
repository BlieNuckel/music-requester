import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JambaseEventsResponse } from "./types";

const mockJambaseGet = vi.fn();

vi.mock("./fetch", () => ({
  jambaseGet: (...args: unknown[]) => mockJambaseGet(...args),
}));

const { searchEvents, countEvents, MAX_PER_PAGE } = await import("./events");

function response(
  overrides: Partial<JambaseEventsResponse> = {}
): JambaseEventsResponse {
  return {
    success: true,
    pagination: { page: 1, perPage: 100, totalItems: 0 },
    events: [],
    ...overrides,
  };
}

function paramsOf(): Record<string, string | number | undefined> {
  const calls = mockJambaseGet.mock.calls;
  return calls[calls.length - 1]?.[1] as Record<
    string,
    string | number | undefined
  >;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockJambaseGet.mockResolvedValue(response());
});

describe("searchEvents params", () => {
  it("pipe-delimits artist ids, which is what makes a roster sweep affordable", async () => {
    await searchEvents({ artistIds: ["jambase:1", "jambase:2", "jambase:3"] });
    expect(paramsOf().artistId).toBe("jambase:1|jambase:2|jambase:3");
  });

  it("pipe-delimits countries", async () => {
    await searchEvents({ countries: ["SE", "DK", "DE"] });
    expect(paramsOf().geoCountryIso2).toBe("SE|DK|DE");
  });

  it("omits artistId and geoCountryIso2 when the lists are empty", async () => {
    await searchEvents({ artistIds: [], countries: [] });
    expect(paramsOf().artistId).toBeUndefined();
    expect(paramsOf().geoCountryIso2).toBeUndefined();
  });

  it("sends radius units only alongside a radius", async () => {
    await searchEvents({ latitude: 55.6, longitude: 13, radiusKm: 150 });
    expect(paramsOf().geoRadiusAmount).toBe(150);
    expect(paramsOf().geoRadiusUnits).toBe("km");

    await searchEvents({ latitude: 55.6, longitude: 13 });
    expect(paramsOf().geoRadiusUnits).toBeUndefined();
  });

  it("caps perPage at the documented maximum", async () => {
    await searchEvents({ perPage: 500 });
    expect(paramsOf().perPage).toBe(MAX_PER_PAGE);
    expect(MAX_PER_PAGE).toBe(100);
  });

  it("defaults to page 1 at the maximum page size", async () => {
    await searchEvents({});
    expect(paramsOf().page).toBe(1);
    expect(paramsOf().perPage).toBe(100);
  });

  it("passes the date window and delta watermark through", async () => {
    await searchEvents({
      dateFrom: "2026-08-17",
      dateTo: "2026-09-14",
      dateModifiedFrom: "2026-08-10 00:00:00",
    });
    expect(paramsOf().eventDateFrom).toBe("2026-08-17");
    expect(paramsOf().eventDateTo).toBe("2026-09-14");
    expect(paramsOf().dateModifiedFrom).toBe("2026-08-10 00:00:00");
  });
});

describe("searchEvents results", () => {
  it("returns pagination from the envelope", async () => {
    mockJambaseGet.mockResolvedValue(
      response({ pagination: { page: 2, perPage: 100, totalItems: 351 } })
    );

    const page = await searchEvents({ page: 2 });
    expect(page.page).toBe(2);
    expect(page.totalItems).toBe(351);
    expect(page.totalPages).toBe(4);
  });

  it("derives totalPages when the envelope omits it", async () => {
    mockJambaseGet.mockResolvedValue(
      response({ pagination: { page: 1, perPage: 100, totalItems: 1339 } })
    );
    expect((await searchEvents({})).totalPages).toBe(14);
  });

  it("prefers the envelope's own totalPages", async () => {
    mockJambaseGet.mockResolvedValue(
      response({
        pagination: { page: 1, perPage: 100, totalItems: 1339, totalPages: 20 },
      })
    );
    expect((await searchEvents({})).totalPages).toBe(20);
  });

  it("survives a missing pagination block", async () => {
    mockJambaseGet.mockResolvedValue({ success: true, events: [] });
    const page = await searchEvents({});
    expect(page.page).toBe(1);
    expect(page.totalItems).toBe(0);
    expect(page.totalPages).toBe(0);
  });

  it("splits events from tombstones", async () => {
    mockJambaseGet.mockResolvedValue(
      response({
        pagination: { page: 1, perPage: 100, totalItems: 2 },
        events: [
          {
            identifier: "jambase:1",
            name: "Show",
            startDate: "2026-09-01T19:00:00Z",
          },
          {
            identifier: "jambase:2",
            deletionStatus: "deleted",
            deletedAt: "2026-08-01T00:00:00Z",
          },
        ],
      })
    );

    const page = await searchEvents({});
    expect(page.events.map((e) => e.event_key)).toEqual(["jambase:1"]);
    expect(page.tombstones.map((t) => t.event_key)).toEqual(["jambase:2"]);
  });
});

describe("countEvents", () => {
  it("asks for a single row and returns the total", async () => {
    mockJambaseGet.mockResolvedValue(
      response({ pagination: { page: 1, perPage: 1, totalItems: 16708 } })
    );

    const total = await countEvents({ countries: ["DE"] });

    expect(total).toBe(16708);
    expect(paramsOf().perPage).toBe(1);
    expect(mockJambaseGet).toHaveBeenCalledTimes(1);
  });
});
