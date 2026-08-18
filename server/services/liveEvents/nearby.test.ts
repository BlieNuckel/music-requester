import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_LIVE_EVENTS } from "../../../shared/settingsDefaults";

const mockGetConfig = vi.fn();
const mockFindNearby = vi.fn();
const mockGetPrefs = vi.fn();
const mockListFollowed = vi.fn();
const mockGetProfile = vi.fn();
const mockGetArtistsImages = vi.fn();

vi.mock("../../config", () => ({
  getConfig: () => mockGetConfig(),
}));

vi.mock("../../db/liveEvents", async () => {
  const actual = await vi.importActual<typeof import("../../db/liveEvents")>(
    "../../db/liveEvents"
  );
  return {
    parseGenres: actual.parseGenres,
    distanceKm: actual.distanceKm,
    findNearbyEvents: (...args: unknown[]) => mockFindNearby(...args),
    getUserLivePreferences: (...args: unknown[]) => mockGetPrefs(...args),
    listFollowedJambaseIds: () => mockListFollowed(),
  };
});

vi.mock("../../api/deezer/artists", () => ({
  getArtistsImages: (...args: unknown[]) => mockGetArtistsImages(...args),
}));

vi.mock("../../db/userProfile", async () => {
  const actual = await vi.importActual<typeof import("../../db/userProfile")>(
    "../../db/userProfile"
  );
  return {
    parseDerivedProfile: actual.parseDerivedProfile,
    getUserProfile: (...args: unknown[]) => mockGetProfile(...args),
  };
});

const { getNearbyShows } = await import("./nearby");

const MALMO = { lat: 55.605, lon: 13.0038 };
const NOW = Date.parse("2026-08-17T12:00:00.000Z");

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

function event(
  eventKey: string,
  genres: string[],
  performerId = "jambase:1"
): Record<string, unknown> {
  return {
    event_key: eventKey,
    event_date: "2026-09-01",
    performers: [
      {
        artist_jambase_id: performerId,
        artist_name: "Artist",
        genres: JSON.stringify(genres),
      },
    ],
  };
}

function profileWith(tags: { tag: string; weight: number }[]) {
  return {
    profile_json: JSON.stringify({
      genreVector: tags,
      artistTags: [],
      similarGraph: [],
      knownAlbums: [],
      explorationHistory: { albums: [], artists: [] },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  configure();
  mockGetPrefs.mockResolvedValue(null);
  mockFindNearby.mockResolvedValue([]);
  mockListFollowed.mockResolvedValue([]);
  mockGetArtistsImages.mockResolvedValue(new Map());
  mockGetProfile.mockResolvedValue(
    profileWith([
      { tag: "shoegaze", weight: 100 },
      { tag: "dream pop", weight: 50 },
    ])
  );
});

describe("getNearbyShows", () => {
  it("returns nothing without a location to search from", async () => {
    configure({ originLat: null, originLon: null });
    expect(await getNearbyShows(1, NOW)).toEqual([]);
    expect(mockFindNearby).not.toHaveBeenCalled();
  });

  it("uses a short horizon and the effective radius", async () => {
    configure({ shelfHorizonDays: 28, sweepRadiusKm: 150 });
    await getNearbyShows(1, NOW);

    const query = mockFindNearby.mock.calls[0][1] as Record<string, unknown>;
    expect(query.radiusKm).toBe(150);

    const days = Math.round(
      (Date.parse(query.to as string) - Date.parse(query.from as string)) /
        86_400_000
    );
    expect(days).toBe(28);
  });

  it("ranks by affinity rather than by date", async () => {
    mockFindNearby.mockResolvedValue([
      { ...event("weak", ["dream pop"]), event_date: "2026-08-20" },
      { ...event("strong", ["shoegaze"]), event_date: "2026-09-10" },
    ]);

    const shows = await getNearbyShows(1, NOW);
    expect(shows.map((show) => show.event.event_key)).toEqual([
      "strong",
      "weak",
    ]);
  });

  it("applies the floor and is willing to return nothing", async () => {
    configure({ shelfMinAffinity: 0.8 });
    mockFindNearby.mockResolvedValue([event("weak", ["dream pop"])]);

    expect(await getNearbyShows(1, NOW)).toEqual([]);
  });

  it("returns everything when the floor is zero", async () => {
    mockFindNearby.mockResolvedValue([event("unknown", ["polka"])]);
    expect(await getNearbyShows(1, NOW)).toHaveLength(1);
  });

  it("flags followed artists instead of filtering them out", async () => {
    mockListFollowed.mockResolvedValue(["jambase:1"]);
    mockFindNearby.mockResolvedValue([
      event("followed", ["shoegaze"], "jambase:1"),
      event("stranger", ["shoegaze"], "jambase:2"),
    ]);

    const shows = await getNearbyShows(1, NOW);

    expect(shows).toHaveLength(2);
    expect(shows.find((s) => s.event.event_key === "followed")?.following).toBe(
      true
    );
    expect(shows.find((s) => s.event.event_key === "stranger")?.following).toBe(
      false
    );
  });

  it("scores everything zero when the user has no profile yet", async () => {
    mockGetProfile.mockResolvedValue(null);
    mockFindNearby.mockResolvedValue([event("a", ["shoegaze"])]);

    const shows = await getNearbyShows(1, NOW);
    expect(shows[0].affinity).toBe(0);
  });

  it("reports the matched genres alongside the score", async () => {
    mockFindNearby.mockResolvedValue([event("a", ["shoegaze", "noise"])]);

    const shows = await getNearbyShows(1, NOW);
    expect(shows[0].affinity).toBe(1);
    expect(shows[0].matchedGenres).toEqual(["shoegaze"]);
  });

  it("fills in a headliner photo for events JamBase gave no image of", async () => {
    mockFindNearby.mockResolvedValue([event("a", ["shoegaze"])]);
    mockGetArtistsImages.mockResolvedValue(
      new Map([["artist", "https://img.test/artist.jpg"]])
    );

    const shows = await getNearbyShows(1, NOW);

    expect(mockGetArtistsImages).toHaveBeenCalledWith(["Artist"]);
    expect(shows[0].artistImageUrl).toBe("https://img.test/artist.jpg");
  });

  it("looks up the headliner rather than the first performer listed", async () => {
    mockFindNearby.mockResolvedValue([
      {
        event_key: "a",
        event_date: "2026-09-01",
        performers: [
          {
            artist_jambase_id: "jambase:2",
            artist_name: "Support",
            genres: null,
            is_headliner: false,
          },
          {
            artist_jambase_id: "jambase:1",
            artist_name: "Headliner",
            genres: null,
            is_headliner: true,
          },
        ],
      },
    ]);

    await getNearbyShows(1, NOW);

    expect(mockGetArtistsImages).toHaveBeenCalledWith(["Headliner"]);
  });

  it("spends no lookup on an event that already has an image", async () => {
    mockFindNearby.mockResolvedValue([
      { ...event("a", ["shoegaze"]), image_url: "https://img.test/event.jpg" },
    ]);

    const shows = await getNearbyShows(1, NOW);

    expect(mockGetArtistsImages).not.toHaveBeenCalled();
    expect(shows[0].artistImageUrl).toBeNull();
  });

  it("only looks up as many images as the shelf can show", async () => {
    mockFindNearby.mockResolvedValue(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => event(`e${n}`, ["shoegaze"]))
    );

    await getNearbyShows(1, NOW);

    expect(mockGetArtistsImages.mock.calls[0][0]).toHaveLength(6);
  });

  it("leaves the photo null when the lookup finds nothing", async () => {
    mockFindNearby.mockResolvedValue([event("a", ["shoegaze"])]);

    const shows = await getNearbyShows(1, NOW);
    expect(shows[0].artistImageUrl).toBeNull();
  });
});
