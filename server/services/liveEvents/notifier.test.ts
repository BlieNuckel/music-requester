import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_LIVE_EVENTS } from "../../../shared/settingsDefaults";

const mockGetConfig = vi.fn();
const mockListUsers = vi.fn();
const mockFindFollowed = vi.fn();
const mockGetPrefs = vi.fn();
const mockMarkNotified = vi.fn();
const mockNotifyEvent = vi.fn();
const mockNotifyStatus = vi.fn();

vi.mock("../../config", () => ({
  getConfig: () => mockGetConfig(),
}));

vi.mock("../../db/liveEvents", async () => {
  const actual = await vi.importActual<typeof import("../../db/liveEvents")>(
    "../../db/liveEvents"
  );
  return {
    distanceKm: actual.distanceKm,
    listUsersWithResolvedFollows: () => mockListUsers(),
    findFollowedUpcomingEvents: (...args: unknown[]) =>
      mockFindFollowed(...args),
    getUserLivePreferences: (...args: unknown[]) => mockGetPrefs(...args),
    markNotified: (...args: unknown[]) => mockMarkNotified(...args),
  };
});

vi.mock("../notifications", () => ({
  notifyLiveEvent: (...args: unknown[]) => mockNotifyEvent(...args),
  notifyLiveStatusChange: (...args: unknown[]) => mockNotifyStatus(...args),
}));

const { notifyLiveUpdates } = await import("./notifier");

const MALMO = { lat: 55.605, lon: 13.0038 };
const NOW = Date.parse("2026-08-17T12:00:00.000Z");
const DAY_MS = 86_400_000;

function day(offset: number): string {
  return new Date(NOW + offset * DAY_MS).toISOString().slice(0, 10);
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
    first_seen_at: new Date(NOW - DAY_MS).toISOString(),
    last_seen_at: new Date(NOW).toISOString(),
    disappeared_at: null,
    deletion_status: null,
    merged_into: null,
    performers: [
      {
        artist_jambase_id: "jambase:1",
        artist_name: "Yves Tumor",
        is_headliner: true,
      },
    ],
    state: null,
    distanceKm: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConfig.mockReturnValue({
    liveEvents: {
      ...DEFAULT_LIVE_EVENTS,
      enabled: true,
      apiKey: "k",
      originLat: MALMO.lat,
      originLon: MALMO.lon,
      regions: ["SE", "DE"],
    },
  });
  mockListUsers.mockResolvedValue([7]);
  mockGetPrefs.mockResolvedValue(null);
  mockFindFollowed.mockResolvedValue([]);
  mockMarkNotified.mockResolvedValue(undefined);
  mockNotifyEvent.mockResolvedValue(undefined);
  mockNotifyStatus.mockResolvedValue(undefined);
});

describe("announcing a new date", () => {
  it("notifies once and records that it did", async () => {
    mockFindFollowed.mockResolvedValue([event()]);

    const outcome = await notifyLiveUpdates(NOW);

    expect(outcome.announced).toBe(1);
    expect(mockNotifyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        artistName: "Yves Tumor",
        venue: "Amiralen, Malmö",
        tier: "local",
      })
    );
    expect(mockMarkNotified).toHaveBeenCalledWith(7, 1, expect.any(String));
  });

  it("does not notify twice for the same event", async () => {
    mockFindFollowed.mockResolvedValue([
      event({ state: { notified_at: new Date(NOW - 1000).toISOString() } }),
    ]);

    expect((await notifyLiveUpdates(NOW)).announced).toBe(0);
    expect(mockNotifyEvent).not.toHaveBeenCalled();
  });

  it("stays silent about anything the banner would not show", async () => {
    mockFindFollowed.mockResolvedValue([
      event({
        event_date: day(120),
        first_seen_at: new Date(NOW - 60 * DAY_MS).toISOString(),
      }),
    ]);

    expect((await notifyLiveUpdates(NOW)).announced).toBe(0);
    expect(mockNotifyEvent).not.toHaveBeenCalled();
  });

  it("never notifies about an out-of-scope show", async () => {
    mockFindFollowed.mockResolvedValue([
      event({ venue_lat: 40.7, venue_lon: -74, venue_country: "US" }),
    ]);

    expect(mockNotifyEvent).not.toHaveBeenCalled();
    expect((await notifyLiveUpdates(NOW)).announced).toBe(0);
  });

  it("marks a regional show as such in the payload", async () => {
    mockFindFollowed.mockResolvedValue([
      event({
        venue_lat: 52.52,
        venue_lon: 13.405,
        venue_country: "DE",
        venue_city: "Berlin",
      }),
    ]);

    await notifyLiveUpdates(NOW);
    expect(mockNotifyEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "regional" })
    );
  });
});

describe("status changes", () => {
  const cancelled = {
    event_status: "cancelled",
    status_changed_at: new Date(NOW - DAY_MS).toISOString(),
  };

  it("notifies even when the event was already announced", async () => {
    mockFindFollowed.mockResolvedValue([
      event({
        ...cancelled,
        state: { notified_at: new Date(NOW - 5 * DAY_MS).toISOString() },
      }),
    ]);

    const outcome = await notifyLiveUpdates(NOW);

    expect(outcome.statusChanges).toBe(1);
    expect(mockNotifyStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" })
    );
  });

  it("notifies someone who already bought tickets", async () => {
    mockFindFollowed.mockResolvedValue([
      event({
        ...cancelled,
        state: {
          response: "going",
          notified_at: new Date(NOW - 5 * DAY_MS).toISOString(),
        },
      }),
    ]);

    expect((await notifyLiveUpdates(NOW)).statusChanges).toBe(1);
  });

  it("notifies someone who dismissed it", async () => {
    mockFindFollowed.mockResolvedValue([
      event({
        ...cancelled,
        state: {
          response: "dismissed",
          notified_at: new Date(NOW - 5 * DAY_MS).toISOString(),
        },
      }),
    ]);

    expect((await notifyLiveUpdates(NOW)).statusChanges).toBe(1);
  });

  it("does not re-announce the same change on the next poll", async () => {
    mockFindFollowed.mockResolvedValue([
      event({
        ...cancelled,
        state: { notified_at: new Date(NOW).toISOString() },
      }),
    ]);

    expect((await notifyLiveUpdates(NOW)).statusChanges).toBe(0);
    expect(mockNotifyStatus).not.toHaveBeenCalled();
  });

  it("covers postponed and rescheduled too", async () => {
    for (const status of ["postponed", "rescheduled"]) {
      vi.clearAllMocks();
      mockFindFollowed.mockResolvedValue([
        event({
          event_status: status,
          status_changed_at: new Date(NOW - DAY_MS).toISOString(),
          state: { notified_at: new Date(NOW - 5 * DAY_MS).toISOString() },
        }),
      ]);

      await notifyLiveUpdates(NOW);
      expect(mockNotifyStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status })
      );
    }
  });
});

describe("across users", () => {
  it("notifies each user separately", async () => {
    mockListUsers.mockResolvedValue([7, 8]);
    mockFindFollowed.mockResolvedValue([event()]);

    const outcome = await notifyLiveUpdates(NOW);

    expect(outcome.announced).toBe(2);
    expect(mockNotifyEvent).toHaveBeenCalledTimes(2);
  });

  it("keeps going when one user fails", async () => {
    mockListUsers.mockResolvedValue([7, 8]);
    mockGetPrefs.mockRejectedValueOnce(new Error("boom"));
    mockFindFollowed.mockResolvedValue([event()]);

    const outcome = await notifyLiveUpdates(NOW);

    expect(outcome.announced).toBe(1);
  });

  it("does nothing when nobody follows a resolved artist", async () => {
    mockListUsers.mockResolvedValue([]);

    expect(await notifyLiveUpdates(NOW)).toEqual({
      announced: 0,
      statusChanges: 0,
    });
    expect(mockFindFollowed).not.toHaveBeenCalled();
  });

  it("still notifies someone who hid the banner, since that is a UI choice", async () => {
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

    // Silencing notifications is what the live.nearbyShow preference is for;
    // hiding the Discover tile should not quietly disable them too.
    await notifyLiveUpdates(NOW);
    expect(mockNotifyEvent).toHaveBeenCalled();
  });
});
