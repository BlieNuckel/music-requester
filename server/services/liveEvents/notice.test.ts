import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_LIVE_EVENTS } from "../../../shared/settingsDefaults";

const mockGetConfig = vi.fn();
const mockFindFollowed = vi.fn();
const mockGetPrefs = vi.fn();

vi.mock("../../config", () => ({
  getConfig: () => mockGetConfig(),
}));

vi.mock("../../db/liveEvents", async () => {
  const actual = await vi.importActual<typeof import("../../db/liveEvents")>(
    "../../db/liveEvents"
  );
  return {
    distanceKm: actual.distanceKm,
    findFollowedUpcomingEvents: (...args: unknown[]) =>
      mockFindFollowed(...args),
    getUserLivePreferences: (...args: unknown[]) => mockGetPrefs(...args),
  };
});

const {
  classifyTier,
  evaluate,
  rankNotices,
  resolvePreferences,
  selectNotice,
} = await import("./notice");

const MALMO = { lat: 55.605, lon: 13.0038 };
const BERLIN = { lat: 52.52, lon: 13.405 };
const NOW = Date.parse("2026-08-17T12:00:00.000Z");
const DAY_MS = 86_400_000;

function day(offset: number): string {
  return new Date(NOW + offset * DAY_MS).toISOString().slice(0, 10);
}

function serverConfig(overrides: Record<string, unknown> = {}) {
  mockGetConfig.mockReturnValue({
    liveEvents: {
      ...DEFAULT_LIVE_EVENTS,
      enabled: true,
      apiKey: "k",
      originLat: MALMO.lat,
      originLon: MALMO.lon,
      regions: ["SE", "DK", "DE"],
      ...overrides,
    },
  });
}

function prefs(overrides: Record<string, unknown> = {}) {
  return resolvePreferences({
    live_radius_km: null,
    live_lat: null,
    live_lon: null,
    live_regions: null,
    live_announce_days: null,
    live_imminent_days_local: null,
    live_imminent_days_regional: null,
    live_banner_enabled: null,
    ...overrides,
  } as never);
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    event_key: "jambase:100",
    name: "Show",
    event_date: day(10),
    previous_start_date: null,
    event_status: "scheduled",
    status_changed_at: null,
    venue_name: "Amiralen",
    venue_city: "Malmö",
    venue_country: "SE",
    venue_lat: MALMO.lat,
    venue_lon: MALMO.lon,
    ticket_url: null,
    image_url: null,
    first_seen_at: new Date(NOW - 60 * DAY_MS).toISOString(),
    last_seen_at: new Date(NOW).toISOString(),
    disappeared_at: null,
    deletion_status: null,
    merged_into: null,
    performers: [],
    state: null,
    distanceKm: null,
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  serverConfig();
  mockGetPrefs.mockResolvedValue(null);
  mockFindFollowed.mockResolvedValue([]);
});

describe("resolvePreferences", () => {
  it("falls back to server values when the user has set none", () => {
    const resolved = prefs();
    expect(resolved.radiusKm).toBe(DEFAULT_LIVE_EVENTS.sweepRadiusKm);
    expect(resolved.lat).toBe(MALMO.lat);
    expect(resolved.regions).toEqual(["SE", "DK", "DE"]);
    expect(resolved.bannerEnabled).toBe(true);
  });

  it("prefers the user's own values", () => {
    const resolved = prefs({
      live_radius_km: 40,
      live_announce_days: 3,
      live_regions: ["NO"],
    });
    expect(resolved.radiusKm).toBe(40);
    expect(resolved.announceDays).toBe(3);
    expect(resolved.regions).toEqual(["NO"]);
  });

  it("clamps a user radius to what the instance actually sweeps", () => {
    serverConfig({ sweepRadiusKm: 150 });
    expect(prefs({ live_radius_km: 900 }).radiusKm).toBe(150);
  });

  it("treats an empty region list as unset rather than as 'nowhere'", () => {
    expect(prefs({ live_regions: [] }).regions).toEqual(["SE", "DK", "DE"]);
  });
});

describe("classifyTier", () => {
  it("calls a nearby venue local", () => {
    const { tier } = classifyTier(event() as never, prefs());
    expect(tier).toBe("local");
  });

  it("calls a venue in an allowed country regional", () => {
    const { tier, distanceKm } = classifyTier(
      event({
        venue_lat: BERLIN.lat,
        venue_lon: BERLIN.lon,
        venue_country: "DE",
      }) as never,
      prefs()
    );
    expect(tier).toBe("regional");
    expect(distanceKm).toBeGreaterThan(300);
  });

  it("calls anything else out of scope", () => {
    const { tier } = classifyTier(
      event({ venue_lat: 40.7, venue_lon: -74, venue_country: "US" }) as never,
      prefs()
    );
    expect(tier).toBe("out-of-scope");
  });

  it("falls back to country when the venue has no coordinates", () => {
    const { tier } = classifyTier(
      event({ venue_lat: null, venue_lon: null, venue_country: "SE" }) as never,
      prefs()
    );
    expect(tier).toBe("regional");
  });

  it("cannot judge distance with no configured origin", () => {
    serverConfig({ originLat: null, originLon: null });
    const { tier } = classifyTier(event() as never, prefs());
    expect(tier).toBe("regional");
  });
});

describe("the two windows", () => {
  it("shows a freshly announced date even when it is far off", () => {
    const candidate = evaluate(
      event({
        event_date: day(120),
        first_seen_at: new Date(NOW - 2 * DAY_MS).toISOString(),
      }),
      prefs(),
      NOW
    );
    expect(candidate?.reason).toBe("just-announced");
  });

  it("goes quiet between the windows, which is the six-month complaint", () => {
    const candidate = evaluate(
      event({
        event_date: day(120),
        first_seen_at: new Date(NOW - 60 * DAY_MS).toISOString(),
      }),
      prefs(),
      NOW
    );
    expect(candidate).toBeNull();
  });

  it("comes back when the date approaches", () => {
    const candidate = evaluate(
      event({
        event_date: day(10),
        first_seen_at: new Date(NOW - 60 * DAY_MS).toISOString(),
      }),
      prefs(),
      NOW
    );
    expect(candidate?.reason).toBe("coming-up");
  });

  it("gives a trip more lead time than a local gig", () => {
    const berlin = {
      venue_lat: BERLIN.lat,
      venue_lon: BERLIN.lon,
      venue_country: "DE",
      first_seen_at: new Date(NOW - 60 * DAY_MS).toISOString(),
    };

    expect(
      evaluate(event({ ...berlin, event_date: day(35) }), prefs(), NOW)
    ).not.toBeNull();

    expect(
      evaluate(
        event({
          event_date: day(35),
          first_seen_at: new Date(NOW - 60 * DAY_MS).toISOString(),
        }),
        prefs(),
        NOW
      )
    ).toBeNull();
  });

  it("ignores dates in the past and beyond the horizon", () => {
    expect(evaluate(event({ event_date: day(-1) }), prefs(), NOW)).toBeNull();
    expect(evaluate(event({ event_date: day(400) }), prefs(), NOW)).toBeNull();
  });

  it("ignores an out-of-scope event entirely", () => {
    expect(
      evaluate(
        event({ venue_lat: 40.7, venue_lon: -74, venue_country: "US" }),
        prefs(),
        NOW
      )
    ).toBeNull();
  });
});

describe("responses", () => {
  it("suppresses an event the user is going to", () => {
    expect(
      evaluate(event({ state: { response: "going" } }), prefs(), NOW)
    ).toBeNull();
  });

  it("suppresses a dismissed event", () => {
    expect(
      evaluate(event({ state: { response: "dismissed" } }), prefs(), NOW)
    ).toBeNull();
  });

  it("still shows an event with a row but no response", () => {
    expect(
      evaluate(event({ state: { response: null } }), prefs(), NOW)
    ).not.toBeNull();
  });
});

describe("the status-change override", () => {
  const cancelled = {
    event_status: "cancelled",
    status_changed_at: new Date(NOW - DAY_MS).toISOString(),
    first_seen_at: new Date(NOW - 90 * DAY_MS).toISOString(),
    event_date: day(120),
  };

  it("reopens an event that both windows had gone quiet on", () => {
    const candidate = evaluate(event(cancelled), prefs(), NOW);
    expect(candidate?.reason).toBe("status-changed");
  });

  it("overrides 'going', which is exactly who needs to know", () => {
    const candidate = evaluate(
      event({ ...cancelled, state: { response: "going" } }),
      prefs(),
      NOW
    );
    expect(candidate?.reason).toBe("status-changed");
  });

  it("overrides a dismissal too", () => {
    expect(
      evaluate(
        event({ ...cancelled, state: { response: "dismissed" } }),
        prefs(),
        NOW
      )
    ).not.toBeNull();
  });

  it("stops shouting once the change is old news", () => {
    expect(
      evaluate(
        event({
          ...cancelled,
          status_changed_at: new Date(NOW - 60 * DAY_MS).toISOString(),
        }),
        prefs(),
        NOW
      )
    ).toBeNull();
  });

  it("treats postponed and rescheduled the same way", () => {
    for (const status of ["postponed", "rescheduled"]) {
      const candidate = evaluate(
        event({ ...cancelled, event_status: status }),
        prefs(),
        NOW
      );
      expect(candidate?.reason).toBe("status-changed");
    }
  });
});

describe("ranking", () => {
  it("puts a status change above everything else", () => {
    const changed = evaluate(
      event({
        event_key: "changed",
        event_status: "cancelled",
        status_changed_at: new Date(NOW - DAY_MS).toISOString(),
        event_date: day(150),
      }),
      prefs(),
      NOW
    );
    const soon = evaluate(
      event({ event_key: "soon", event_date: day(1) }),
      prefs(),
      NOW
    );

    const ranked = rankNotices([soon!, changed!]);
    expect(ranked[0].event.event_key).toBe("changed");
  });

  it("prefers local over regional at the same date", () => {
    const local = evaluate(event({ event_key: "local" }), prefs(), NOW);
    const regional = evaluate(
      event({
        event_key: "regional",
        venue_lat: BERLIN.lat,
        venue_lon: BERLIN.lon,
        venue_country: "DE",
      }),
      prefs(),
      NOW
    );

    expect(rankNotices([regional!, local!])[0].event.event_key).toBe("local");
  });

  it("prefers the sooner of two comparable events", () => {
    const soon = evaluate(
      event({ event_key: "soon", event_date: day(3) }),
      prefs(),
      NOW
    );
    const later = evaluate(
      event({ event_key: "later", event_date: day(18) }),
      prefs(),
      NOW
    );

    expect(rankNotices([later!, soon!])[0].event.event_key).toBe("soon");
  });
});

describe("selectNotice", () => {
  it("returns the top notice and a count of the rest", async () => {
    mockFindFollowed.mockResolvedValue([
      event({ id: 1, event_key: "a", event_date: day(12) }),
      event({ id: 2, event_key: "b", event_date: day(3) }),
      event({ id: 3, event_key: "c", event_date: day(400) }),
    ]);

    const result = await selectNotice(1, NOW);

    expect(result.notice?.event.event_key).toBe("b");
    expect(result.additionalCount).toBe(1);
  });

  it("returns nothing when nothing qualifies", async () => {
    mockFindFollowed.mockResolvedValue([
      event({
        event_date: day(120),
        first_seen_at: new Date(NOW - 60 * DAY_MS).toISOString(),
      }),
    ]);

    expect(await selectNotice(1, NOW)).toEqual({
      notice: null,
      additionalCount: 0,
    });
  });

  it("respects a user who turned the banner off", async () => {
    mockGetPrefs.mockResolvedValue({
      live_banner_enabled: false,
      live_radius_km: null,
      live_lat: null,
      live_lon: null,
      live_regions: null,
      live_announce_days: null,
      live_imminent_days_local: null,
      live_imminent_days_regional: null,
    });
    mockFindFollowed.mockResolvedValue([event()]);

    const result = await selectNotice(1, NOW);
    expect(result.notice).toBeNull();
    expect(mockFindFollowed).not.toHaveBeenCalled();
  });

  it("queries the horizon window rather than everything stored", async () => {
    await selectNotice(1, NOW);
    const query = mockFindFollowed.mock.calls[0][1] as {
      from: string;
      to: string;
    };
    expect(query.from).toBe(day(0));
    expect(query.to).toBe(day(DEFAULT_LIVE_EVENTS.bannerHorizonDays));
  });
});
