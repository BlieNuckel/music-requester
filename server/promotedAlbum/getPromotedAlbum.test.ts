import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PromotedAlbumConfig } from "../config";

const mockLoadArtistWeights = vi.fn();
const mockGetArtistTopTags = vi.fn();
const mockGetTopAlbumsByTag = vi.fn();
const mockLidarrGet = vi.fn();
const mockResolveReleaseGroupInfo = vi.fn();
const mockFetchReleaseGroupsForArtist = vi.fn();
const mockGetConfigValue = vi.fn();
const mockGetSimilarArtists = vi.fn();
const mockGetArtistMbidByName = vi.fn();

vi.mock("./artistWeights", () => ({
  loadArtistWeights: (...args: unknown[]) => mockLoadArtistWeights(...args),
}));

vi.mock("../api/lastfm/artists", () => ({
  getArtistTopTags: (...args: unknown[]) => mockGetArtistTopTags(...args),
}));

vi.mock("../api/lastfm/albums", () => ({
  getTopAlbumsByTag: (...args: unknown[]) => mockGetTopAlbumsByTag(...args),
}));

vi.mock("../api/lidarr/get", () => ({
  lidarrGet: (...args: unknown[]) => mockLidarrGet(...args),
}));

vi.mock("../api/musicbrainz/releaseGroups", () => ({
  resolveReleaseGroupInfo: (...args: unknown[]) =>
    mockResolveReleaseGroupInfo(...args),
  fetchReleaseGroupsForArtist: (...args: unknown[]) =>
    mockFetchReleaseGroupsForArtist(...args),
}));

vi.mock("../api/listenbrainz/similarArtists", () => ({
  getSimilarArtists: (...args: unknown[]) => mockGetSimilarArtists(...args),
}));

vi.mock("../api/musicbrainz/artists", () => ({
  getArtistMbidByName: (...args: unknown[]) => mockGetArtistMbidByName(...args),
}));

vi.mock("../config", () => ({
  getConfigValue: (...args: unknown[]) => mockGetConfigValue(...args),
}));

import { getPromotedAlbums, clearPromotedAlbumCache } from "./getPromotedAlbum";
import { initializeDatabase, closeDatabase, getDataSource } from "../db";
import type { WithinTasteResult, ExploreResult } from "./types";

/** Single-pick view of the carousel batch, so per-selection cases stay readable. */
async function getOne(userId: number, forceRefresh = false) {
  const [first] = await getPromotedAlbums(userId, forceRefresh, 1);
  return first ?? null;
}

/** Narrows a result to within-taste; the suite forces this via explorationRate: 0. */
function wt(result: Awaited<ReturnType<typeof getOne>>): WithinTasteResult {
  if (!result || result.mode !== "within_taste") {
    throw new Error("expected a within_taste result");
  }
  return result;
}

function ex(result: Awaited<ReturnType<typeof getOne>>): ExploreResult {
  if (!result || result.mode !== "explore") {
    throw new Error("expected an explore result");
  }
  return result;
}

async function createUserWithToken(token: string): Promise<number> {
  const ds = getDataSource();
  await ds.query(
    "INSERT INTO users (plex_token, user_type, enabled) VALUES (?, 'plex', 1)",
    [token]
  );
  const rows = (await ds.query("SELECT id FROM users WHERE plex_token = ?", [
    token,
  ])) as { id: number }[];
  return rows[rows.length - 1].id;
}

const defaultPromotedAlbumConfig: PromotedAlbumConfig = {
  cacheDurationMinutes: 30,
  profileTtlMinutes: 1440,
  topArtistsCount: 10,
  explorationRate: 0,
  exploreCandidateCount: 12,
  genreOverlapThreshold: 0.15,
  pickedArtistsCount: 3,
  tagsPerArtist: 5,
  deepPageMin: 2,
  deepPageMax: 10,
  genericTags: [
    "seen live",
    "favorites",
    "favourite",
    "my favorite",
    "love",
    "awesome",
    "beautiful",
    "cool",
    "check out",
    "spotify",
    "under 2000 listeners",
    "all",
  ],
  libraryPreference: "prefer_new",
  backgroundRegenEnabled: false,
  backgroundRegenIntervalMinutes: 60,
  backgroundRegenActiveWithinMinutes: 10080,
  ratingsBackupEnabled: true,
  playTrendWindowDays: 90,
  ratingWeight: 0.5,
  distributionWeight: 0,
  minPlaysForDistribution: 5,
};

let userId: number;

beforeEach(async () => {
  vi.clearAllMocks();
  clearPromotedAlbumCache();
  vi.spyOn(Math, "random").mockReturnValue(0.1);
  mockGetConfigValue.mockReturnValue(defaultPromotedAlbumConfig);
  mockResolveReleaseGroupInfo.mockImplementation((mbid: string) =>
    Promise.resolve({
      id: `rg-${mbid}`,
      firstReleaseDate: "1997-06-16",
      primaryType: "Album",
      secondaryTypes: [],
    })
  );
  await initializeDatabase(":memory:");
  userId = await createUserWithToken("test-plex-token");
});

afterEach(async () => {
  await closeDatabase();
});

const plexArtists = [
  { name: "Radiohead", viewCount: 100, thumb: "", genres: [] },
  { name: "Bjork", viewCount: 50, thumb: "", genres: [] },
];

const tags = [
  { name: "alternative", count: 100 },
  { name: "rock", count: 80 },
];

const albumsPage = {
  albums: [
    {
      name: "OK Computer",
      mbid: "alb-1",
      artistName: "Radiohead",
      artistMbid: "art-1",
    },
    {
      name: "Kid A",
      mbid: "alb-2",
      artistName: "Radiohead",
      artistMbid: "art-1",
    },
  ],
  pagination: { page: 1, totalPages: 5 },
};

/** Deep enough for a full five-slide carousel plus anti-repeat headroom. */
const bigAlbumsPage = {
  albums: Array.from({ length: 8 }, (_, i) => ({
    name: `Album ${i + 1}`,
    mbid: `alb-${i + 1}`,
    artistName: "Radiohead",
    artistMbid: "art-1",
  })),
  pagination: { page: 1, totalPages: 5 },
};

const exploreConfig = { ...defaultPromotedAlbumConfig, explorationRate: 1 };

const similarArtists = [
  {
    artist_mbid: "mbid-rock",
    name: "Rock Clone",
    comment: "",
    type: "Group",
    gender: null,
    score: 9000,
    reference_mbid: "mbid-seed",
  },
  {
    artist_mbid: "mbid-jazz",
    name: "Jazz Cat",
    comment: "",
    type: "Group",
    gender: null,
    score: 5000,
    reference_mbid: "mbid-seed",
  },
];

const genreByArtist: Record<string, { name: string; count: number }[]> = {
  Radiohead: [
    { name: "alternative", count: 100 },
    { name: "rock", count: 80 },
  ],
  "Rock Clone": [
    { name: "alternative", count: 100 },
    { name: "rock", count: 80 },
  ],
  "Jazz Cat": [
    { name: "jazz", count: 100 },
    { name: "bebop", count: 50 },
  ],
};

const jazzReleaseGroups = [
  {
    id: "rg-jazz-1",
    score: 1,
    title: "Blue Album",
    "primary-type": "Album",
    "first-release-date": "1965-03-01",
    "artist-credit": [
      { name: "Jazz Cat", artist: { id: "mbid-jazz", name: "Jazz Cat" } },
    ],
  },
];

describe("getPromotedAlbums", () => {
  it("returns a promoted album on happy path with correct shape", async () => {
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockResolvedValue({
      ok: true,
      data: [],
    });

    const result = await getOne(userId);
    expect(result).not.toBeNull();
    expect(result!.album).toEqual({
      name: expect.any(String),
      mbid: expect.any(String),
      artistName: expect.any(String),
      artistMbid: expect.any(String),
      coverUrl: expect.stringMatching(
        /^https:\/\/coverartarchive\.org\/release-group\//
      ),
      year: "1997",
    });
    expect(wt(result).tag).toBe("alternative");
    expect(result!.inLibrary).toBe(false);
    expect(mockLoadArtistWeights).toHaveBeenCalledWith(
      expect.any(Number),
      "test-plex-token",
      expect.objectContaining({ windowMs: expect.any(Number) })
    );
  });

  it("returns null when the user has no stored Plex token", async () => {
    const tokenlessId = (
      (await getDataSource().query(
        "INSERT INTO users (user_type, enabled) VALUES ('local', 1) RETURNING id"
      )) as { id: number }[]
    )[0].id;

    const result = await getOne(tokenlessId);
    expect(result).toBeNull();
    expect(mockLoadArtistWeights).not.toHaveBeenCalled();
  });

  it("fetches both page 1 and a deep page of tag albums", async () => {
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

    await getOne(userId);

    expect(mockGetTopAlbumsByTag).toHaveBeenCalledTimes(2);
    const calls = mockGetTopAlbumsByTag.mock.calls;
    expect(calls[0][1]).toBe("1");
    const deepPage = Number(calls[1][1]);
    expect(deepPage).toBeGreaterThanOrEqual(2);
    expect(deepPage).toBeLessThanOrEqual(10);
  });

  it("returns null when Plex has no artists", async () => {
    mockLoadArtistWeights.mockResolvedValue([]);

    const result = await getOne(userId);
    expect(result).toBeNull();
  });

  it("returns null when all tags are generic", async () => {
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue([
      { name: "seen live", count: 100 },
      { name: "favorites", count: 80 },
    ]);

    const result = await getOne(userId);
    expect(result).toBeNull();
  });

  it("handles tag fetch failures gracefully", async () => {
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockRejectedValue(new Error("API error"));

    const result = await getOne(userId);
    expect(result).toBeNull();
  });

  it("filters albums without MBIDs", async () => {
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue({
      albums: [
        { name: "No MBID", mbid: "", artistName: "Someone", artistMbid: "x" },
      ],
      pagination: { page: 1, totalPages: 1 },
    });
    mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

    const result = await getOne(userId);
    expect(result).toBeNull();
  });

  it("filters Various Artists compilations out of the album pool", async () => {
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue({
      albums: [
        {
          name: "Now That's What I Call Music",
          mbid: "alb-va",
          artistName: "Various Artists",
          artistMbid: "art-va",
        },
        ...albumsPage.albums,
      ],
      pagination: { page: 1, totalPages: 1 },
    });
    mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

    const result = await getOne(userId);
    expect(result!.album.artistName).toBe("Radiohead");
  });

  it("marks inLibrary true when the album is in the Lidarr album list", async () => {
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockImplementation((path: string) => {
      if (path === "/artist") {
        return Promise.resolve({
          ok: true,
          data: [{ foreignArtistId: "art-1" }],
        });
      }
      return Promise.resolve({
        ok: true,
        data: [
          { foreignAlbumId: "rg-alb-1", monitored: true },
          { foreignAlbumId: "rg-alb-2", monitored: true },
        ],
      });
    });

    const result = await getOne(userId);
    expect(result).not.toBeNull();
    expect(result!.inLibrary).toBe(true);
  });

  it("reports the library state as requested when Lidarr holds no files", async () => {
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockImplementation((path: string) => {
      if (path === "/artist") {
        return Promise.resolve({ ok: true, data: [] });
      }
      return Promise.resolve({
        ok: true,
        data: ["rg-alb-1", "rg-alb-2"].map((foreignAlbumId) => ({
          foreignAlbumId,
          monitored: true,
          statistics: {
            trackFileCount: 0,
            totalTrackCount: 7,
            percentOfTracks: 0,
          },
        })),
      });
    });

    const result = await getOne(userId);
    expect(result!.inLibrary).toBe(true);
    expect(result!.library).toEqual({
      state: "requested",
      available: 0,
      total: 7,
    });
  });

  it("ignores unmonitored discography rows so untouched albums read as absent", async () => {
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockImplementation((path: string) => {
      if (path === "/artist") {
        return Promise.resolve({ ok: true, data: [] });
      }
      return Promise.resolve({
        ok: true,
        data: ["rg-alb-1", "rg-alb-2"].map((foreignAlbumId) => ({
          foreignAlbumId,
          monitored: false,
          statistics: {
            trackFileCount: 0,
            totalTrackCount: 12,
            percentOfTracks: 0,
          },
        })),
      });
    });

    const result = await getOne(userId);
    expect(result!.inLibrary).toBe(false);
    expect(result!.library).toBeNull();
  });

  it("reports the library state as complete when every track has a file", async () => {
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockImplementation((path: string) => {
      if (path === "/artist") {
        return Promise.resolve({ ok: true, data: [] });
      }
      return Promise.resolve({
        ok: true,
        data: ["rg-alb-1", "rg-alb-2"].map((foreignAlbumId) => ({
          foreignAlbumId,
          monitored: true,
          statistics: {
            trackFileCount: 7,
            totalTrackCount: 7,
            percentOfTracks: 100,
          },
        })),
      });
    });

    const result = await getOne(userId);
    expect(result!.library).toEqual({
      state: "complete",
      available: 7,
      total: 7,
    });
  });

  it("marks inLibrary false when artist is in library but album is not", async () => {
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockImplementation((path: string) => {
      if (path === "/artist") {
        return Promise.resolve({
          ok: true,
          data: [{ foreignArtistId: "art-1" }],
        });
      }
      return Promise.resolve({ ok: true, data: [] });
    });

    const result = await getOne(userId);
    expect(result).not.toBeNull();
    expect(result!.inLibrary).toBe(false);
    expect(result!.library).toBeNull();
  });

  it("returns the cached result within the result-cache TTL", async () => {
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

    const first = await getOne(userId);
    mockLoadArtistWeights.mockClear();
    mockGetTopAlbumsByTag.mockClear();

    const second = await getOne(userId);
    expect(second).toEqual(first);
    expect(mockLoadArtistWeights).not.toHaveBeenCalled();
    expect(mockGetTopAlbumsByTag).not.toHaveBeenCalled();
  });

  it("caches results per user — different users get independent results", async () => {
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

    const userA = await createUserWithToken("user-a-token");
    const userB = await createUserWithToken("user-b-token");

    await getOne(userA);
    mockLoadArtistWeights.mockClear();

    await getOne(userB);
    expect(mockLoadArtistWeights).toHaveBeenCalledWith(
      expect.any(Number),
      "user-b-token",
      expect.objectContaining({ windowMs: expect.any(Number) })
    );
  });

  it("force refresh re-selects an album without re-running the fan-out", async () => {
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

    await getOne(userId);
    mockLoadArtistWeights.mockClear();
    mockGetTopAlbumsByTag.mockClear();

    await getOne(userId, true);
    expect(mockLoadArtistWeights).not.toHaveBeenCalled();
    expect(mockGetTopAlbumsByTag).toHaveBeenCalled();
  });

  it("falls back gracefully when Lidarr is unavailable", async () => {
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockRejectedValue(new Error("Connection refused"));

    const result = await getOne(userId);
    expect(result).not.toBeNull();
    expect(result!.inLibrary).toBe(false);
  });

  it("treats all as not in library when Lidarr returns ok: false", async () => {
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockResolvedValue({ ok: false, status: 500, data: {} });

    const result = await getOne(userId);
    expect(result).not.toBeNull();
    expect(result!.inLibrary).toBe(false);
  });

  it("re-selects an album after the result cache expires, without re-fanning-out", async () => {
    vi.useFakeTimers();
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

    await getOne(userId);
    mockLoadArtistWeights.mockClear();
    mockGetTopAlbumsByTag.mockClear();

    vi.advanceTimersByTime(31 * 60 * 1000);
    await getOne(userId);
    expect(mockLoadArtistWeights).not.toHaveBeenCalled();
    expect(mockGetTopAlbumsByTag).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("regenerates the profile after the profile TTL expires", async () => {
    vi.useFakeTimers();
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

    await getOne(userId);
    mockLoadArtistWeights.mockClear();

    vi.advanceTimersByTime((1440 + 1) * 60 * 1000);
    await getOne(userId);
    expect(mockLoadArtistWeights).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("respects custom result-cache duration from config", async () => {
    vi.useFakeTimers();
    mockGetConfigValue.mockReturnValue({
      ...defaultPromotedAlbumConfig,
      cacheDurationMinutes: 5,
    });
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

    await getOne(userId);
    mockGetTopAlbumsByTag.mockClear();

    vi.advanceTimersByTime(6 * 60 * 1000);
    await getOne(userId);
    expect(mockGetTopAlbumsByTag).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("deduplicates albums from both pages", async () => {
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);

    const duplicatedPage = {
      albums: [
        {
          name: "OK Computer",
          mbid: "alb-1",
          artistName: "Radiohead",
          artistMbid: "art-1",
        },
      ],
      pagination: { page: 1, totalPages: 1 },
    };
    mockGetTopAlbumsByTag.mockResolvedValue(duplicatedPage);
    mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

    const result = await getOne(userId);
    expect(result).not.toBeNull();
    // MBID is converted from release to release-group
    expect(result!.album.mbid).toBe("rg-alb-1");
  });

  it("returns null when no albums can be converted to release-groups", async () => {
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockResolvedValue({ ok: true, data: [] });
    mockResolveReleaseGroupInfo.mockResolvedValue(null);

    const result = await getOne(userId);
    expect(result).toBeNull();
  });

  describe("anti-repeat", () => {
    it("avoids re-showing the most recent album on refresh", async () => {
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const first = await getOne(userId);
      const second = await getOne(userId, true);

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(second!.album.mbid).not.toBe(first!.album.mbid);
    });

    it("persists anti-repeat memory across a simulated restart", async () => {
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const first = await getOne(userId);

      // Simulate a restart: in-memory result cache is gone, DB persists.
      clearPromotedAlbumCache();

      const second = await getOne(userId, true);
      expect(second!.album.mbid).not.toBe(first!.album.mbid);
    });

    it("falls back to the full pool when every album was recently shown", async () => {
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue({
        albums: [albumsPage.albums[0]],
        pagination: { page: 1, totalPages: 1 },
      });
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const first = await getOne(userId);
      const second = await getOne(userId, true);

      expect(first).not.toBeNull();
      expect(second!.album.mbid).toBe(first!.album.mbid);
    });

    it("remembers the release group, so two release MBIDs for one album count as one", async () => {
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });
      // Both chart entries are pressings of the same album, as Last.fm hands them back.
      mockResolveReleaseGroupInfo.mockResolvedValue({
        id: "rg-shared",
        firstReleaseDate: "1997-06-16",
        primaryType: "Album",
        secondaryTypes: [],
      });

      const first = await getOne(userId);
      const second = await getOne(userId, true);

      expect(first!.album.mbid).toBe("rg-shared");
      expect(second!.album.mbid).toBe("rg-shared");
      expect(second!.trace.selectionReason).toBe(first!.trace.selectionReason);
    });

    it("skips release types that are not albums", async () => {
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });
      mockResolveReleaseGroupInfo.mockImplementation((mbid: string) =>
        Promise.resolve({
          id: `rg-${mbid}`,
          firstReleaseDate: "1997-06-16",
          primaryType: "Album",
          secondaryTypes: mbid === "alb-1" ? ["Compilation"] : [],
        })
      );

      const results = await getPromotedAlbums(userId, false, 2);

      expect(results.map((r) => r.album.mbid)).toEqual(["rg-alb-2"]);
    });

    it("returns nothing when every candidate is a live album or compilation", async () => {
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });
      mockResolveReleaseGroupInfo.mockImplementation((mbid: string) =>
        Promise.resolve({
          id: `rg-${mbid}`,
          firstReleaseDate: "1997-06-16",
          primaryType: "Album",
          secondaryTypes: ["Live"],
        })
      );

      expect(await getOne(userId)).toBeNull();
    });
  });

  describe("carousel batch", () => {
    function mockHappyPath(albums = bigAlbumsPage) {
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albums);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });
    }

    it("returns five distinct albums by default", async () => {
      mockHappyPath();

      const results = await getPromotedAlbums(userId);
      expect(results).toHaveLength(5);
      expect(new Set(results.map((r) => r.album.mbid)).size).toBe(5);
    });

    it("returns the requested number of albums", async () => {
      mockHappyPath();

      const results = await getPromotedAlbums(userId, false, 3);
      expect(results).toHaveLength(3);
    });

    it("returns a shorter batch when the pool cannot fill it", async () => {
      mockHappyPath(albumsPage);

      const results = await getPromotedAlbums(userId, false, 5);
      expect(results).toHaveLength(2);
      expect(new Set(results.map((r) => r.album.mbid)).size).toBe(2);
    });

    it("returns an empty list when nothing can be built", async () => {
      mockLoadArtistWeights.mockResolvedValue([]);

      const results = await getPromotedAlbums(userId);
      expect(results).toEqual([]);
    });

    it("serves the whole batch from cache on the next call", async () => {
      mockHappyPath();

      const first = await getPromotedAlbums(userId);
      mockGetTopAlbumsByTag.mockClear();

      const second = await getPromotedAlbums(userId);
      expect(second).toEqual(first);
      expect(mockGetTopAlbumsByTag).not.toHaveBeenCalled();
    });

    it("rebuilds when the cached batch is smaller than the requested count", async () => {
      mockHappyPath();

      await getPromotedAlbums(userId, false, 1);
      mockGetTopAlbumsByTag.mockClear();

      const results = await getPromotedAlbums(userId, false, 4);
      expect(results).toHaveLength(4);
      expect(mockGetTopAlbumsByTag).toHaveBeenCalled();
    });

    it("remembers every album in the batch for anti-repeat", async () => {
      mockHappyPath();

      const first = await getPromotedAlbums(userId, false, 3);
      const second = await getPromotedAlbums(userId, true, 3);

      const firstMbids = new Set(first.map((r) => r.album.mbid));
      expect(second).toHaveLength(3);
      for (const result of second) {
        expect(firstMbids.has(result.album.mbid)).toBe(false);
      }
    });
  });

  describe("trace", () => {
    it("has correct number of plexArtists entries", async () => {
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const result = await getOne(userId);
      expect(wt(result).trace.plexArtists).toHaveLength(2);
      expect(wt(result).trace.plexArtists.map((a) => a.name)).toEqual([
        "Radiohead",
        "Bjork",
      ]);
    });

    it("marks the picked artists", async () => {
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const result = await getOne(userId);
      const picked = wt(result).trace.plexArtists.filter((a) => a.picked);
      expect(picked).toHaveLength(2);
    });

    it("chosenTag name matches result tag", async () => {
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const result = await getOne(userId);
      expect(wt(result).trace.chosenTag.name).toBe(wt(result).tag);
    });

    it("albumPool counts are accurate", async () => {
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const result = await getOne(userId);
      const { albumPool } = wt(result).trace;
      expect(albumPool.page1Count).toBe(2);
      expect(albumPool.deepPageCount).toBe(2);
      expect(albumPool.totalAfterDedup).toBe(2);
      expect(albumPool.deepPage).toBeGreaterThanOrEqual(2);
      expect(albumPool.deepPage).toBeLessThanOrEqual(10);
    });

    it("selectionReason is preferred_non_library when artist not in library", async () => {
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const result = await getOne(userId);
      expect(result!.trace.selectionReason).toBe("preferred_non_library");
    });

    it("selectionReason is fallback_in_library when all artists are in library", async () => {
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockImplementation((path: string) => {
        if (path === "/artist") {
          return Promise.resolve({
            ok: true,
            data: [{ foreignArtistId: "art-1" }],
          });
        }
        return Promise.resolve({
          ok: true,
          data: [
            { foreignAlbumId: "rg-alb-1", monitored: true },
            { foreignAlbumId: "rg-alb-2", monitored: true },
          ],
        });
      });

      const result = await getOne(userId);
      expect(result!.trace.selectionReason).toBe("fallback_in_library");
    });

    it("merges same tags from multiple artists with combined weight", async () => {
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const result = await getOne(userId);
      const altTag = wt(result).trace.weightedTags.find(
        (t) => t.name === "alternative"
      );
      expect(altTag).toBeDefined();
      expect(altTag!.fromArtists).toContain("Radiohead");
      expect(altTag!.fromArtists).toContain("Bjork");
      const share = 100 / (100 + 80);
      expect(altTag!.weight).toBeCloseTo(share * 100 + share * 50);
    });

    it("picked artists have tagContributions populated", async () => {
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const result = await getOne(userId);
      const radiohead = wt(result).trace.plexArtists.find(
        (a) => a.name === "Radiohead"
      );
      expect(radiohead!.tagContributions).toHaveLength(2);
      expect(radiohead!.tagContributions[0].tagName).toBe("alternative");
    });

    it("carries the play-distribution stats into the trace", async () => {
      mockLoadArtistWeights.mockResolvedValue([
        {
          name: "Radiohead",
          viewCount: 100,
          distinctTracksPlayed: 6,
          topTrackShare: 0.3,
          distributionFactor: 0.85,
        },
      ]);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const result = await getOne(userId);

      expect(wt(result).trace.plexArtists[0]).toMatchObject({
        name: "Radiohead",
        distinctTracksPlayed: 6,
        topTrackShare: 0.3,
        distributionFactor: 0.85,
      });
    });
  });

  describe("config-driven behavior", () => {
    it("derives the play-trend window from playTrendWindowDays", async () => {
      mockGetConfigValue.mockReturnValue({
        ...defaultPromotedAlbumConfig,
        playTrendWindowDays: 30,
      });
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      await getOne(userId);
      expect(mockLoadArtistWeights).toHaveBeenCalledWith(
        expect.any(Number),
        "test-plex-token",
        expect.objectContaining({ windowMs: 30 * 24 * 60 * 60 * 1000 })
      );
    });

    it("passes ratingWeight from config to the weight source", async () => {
      mockGetConfigValue.mockReturnValue({
        ...defaultPromotedAlbumConfig,
        ratingWeight: 1.0,
      });
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      await getOne(userId);
      expect(mockLoadArtistWeights).toHaveBeenCalledWith(
        expect.any(Number),
        "test-plex-token",
        expect.objectContaining({ ratingWeight: 1.0 })
      );
    });

    it("uses custom genericTags from config", async () => {
      mockGetConfigValue.mockReturnValue({
        ...defaultPromotedAlbumConfig,
        genericTags: ["alternative"],
      });
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const result = await getOne(userId);
      if (result) {
        expect(wt(result).tag).toBe("rock");
      }
    });

    it("prefer_library mode selects library artist first", async () => {
      mockGetConfigValue.mockReturnValue({
        ...defaultPromotedAlbumConfig,
        libraryPreference: "prefer_library",
      });

      const libraryAlbums = {
        albums: [
          {
            name: "Library Album",
            mbid: "lib-1",
            artistName: "Library Artist",
            artistMbid: "lib-art-1",
          },
          {
            name: "New Album",
            mbid: "new-1",
            artistName: "New Artist",
            artistMbid: "new-art-1",
          },
        ],
        pagination: { page: 1, totalPages: 1 },
      };

      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(libraryAlbums);
      mockLidarrGet.mockImplementation((p: string) => {
        if (p === "/artist") {
          return Promise.resolve({
            ok: true,
            data: [{ foreignArtistId: "lib-art-1" }],
          });
        }
        return Promise.resolve({ ok: true, data: [] });
      });

      const result = await getOne(userId);
      expect(result).not.toBeNull();
      expect(result!.trace.selectionReason).toBe("preferred_library");
      expect(result!.album.artistMbid).toBe("lib-art-1");
    });

    it("no_preference mode selects first valid album", async () => {
      mockGetConfigValue.mockReturnValue({
        ...defaultPromotedAlbumConfig,
        libraryPreference: "no_preference",
      });
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const result = await getOne(userId);
      expect(result).not.toBeNull();
      expect(result!.trace.selectionReason).toBe("no_preference");
    });

    it("uses deepPageMin and deepPageMax from config", async () => {
      mockGetConfigValue.mockReturnValue({
        ...defaultPromotedAlbumConfig,
        deepPageMin: 5,
        deepPageMax: 5,
      });
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      await getOne(userId);
      const calls = mockGetTopAlbumsByTag.mock.calls;
      expect(calls[1][1]).toBe("5");
    });
  });

  describe("explore mode", () => {
    function setupExplore() {
      mockGetConfigValue.mockReturnValue(exploreConfig);
      mockLoadArtistWeights.mockResolvedValue(plexArtists);
      mockGetArtistMbidByName.mockResolvedValue("mbid-seed");
      mockGetSimilarArtists.mockResolvedValue(similarArtists);
      mockGetArtistTopTags.mockImplementation((name: string) =>
        Promise.resolve(genreByArtist[name] ?? [])
      );
      mockFetchReleaseGroupsForArtist.mockImplementation((mbid: string) =>
        Promise.resolve(mbid === "mbid-jazz" ? jazzReleaseGroups : [])
      );
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });
    }

    it("surfaces a genre-distant album from a similar artist", async () => {
      setupExplore();

      const result = await getOne(userId);
      expect(ex(result).mode).toBe("explore");
      expect(ex(result).seedArtist).toBe("Radiohead");
      expect(ex(result).album.name).toBe("Blue Album");
      expect(ex(result).album.artistName).toBe("Jazz Cat");
      expect(ex(result).album.mbid).toBe("rg-jazz-1");
      expect(ex(result).album.year).toBe("1965");
    });

    it("reports the new genres the seed does not share", async () => {
      setupExplore();

      const result = await getOne(userId);
      expect(ex(result).newGenres).toEqual(["jazz", "bebop"]);
    });

    it("chooses the genre-distant candidate, not the same-genre one", async () => {
      setupExplore();

      const result = await getOne(userId);
      const { candidates, chosenArtist } = ex(result).trace;
      expect(chosenArtist).toBe("Jazz Cat");

      const jazz = candidates.find((c) => c.name === "Jazz Cat");
      const rock = candidates.find((c) => c.name === "Rock Clone");
      expect(jazz!.isDifferentGenre).toBe(true);
      expect(jazz!.chosen).toBe(true);
      expect(rock!.isDifferentGenre).toBe(false);
      expect(rock!.chosen).toBe(false);
    });

    it("falls back to within-taste when the seed has no MBID", async () => {
      setupExplore();
      mockGetArtistMbidByName.mockResolvedValue(null);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);

      const result = await getOne(userId);
      expect(result!.mode).toBe("within_taste");
    });

    it("falls back to within-taste when ListenBrainz returns no similar artists", async () => {
      setupExplore();
      mockGetSimilarArtists.mockResolvedValue([]);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);

      const result = await getOne(userId);
      expect(result!.mode).toBe("within_taste");
    });

    it("falls back to within-taste when no candidate is a different genre", async () => {
      setupExplore();
      mockGetArtistTopTags.mockResolvedValue(genreByArtist["Radiohead"]);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);

      const result = await getOne(userId);
      expect(result!.mode).toBe("within_taste");
    });

    it("builds the similar graph once at regen, not per explore request", async () => {
      setupExplore();

      await getOne(userId);
      expect(mockGetSimilarArtists).toHaveBeenCalled();
      mockGetArtistMbidByName.mockClear();
      mockGetSimilarArtists.mockClear();

      const second = await getOne(userId, true);
      expect(ex(second).mode).toBe("explore");
      expect(mockGetArtistMbidByName).not.toHaveBeenCalled();
      expect(mockGetSimilarArtists).not.toHaveBeenCalled();
    });

    it("does not repeat the most recent album across refreshes", async () => {
      setupExplore();
      mockFetchReleaseGroupsForArtist.mockImplementation((mbid: string) =>
        Promise.resolve(
          mbid === "mbid-jazz"
            ? [
                jazzReleaseGroups[0],
                { ...jazzReleaseGroups[0], id: "rg-jazz-2", title: "Green" },
              ]
            : []
        )
      );

      const first = await getOne(userId);
      const second = await getOne(userId, true);
      expect(ex(first).album.mbid).not.toBe(ex(second).album.mbid);
    });
  });
});

describe("injected randomness and clock", () => {
  /**
   * Feeds rng one value per call so an individual decision can be pinned. Call order
   * within a pick is: explore/within-taste coin, tag pick, deep page, then shuffling.
   */
  function seqRng(values: number[]) {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)];
  }

  const exploreCapable = {
    ...defaultPromotedAlbumConfig,
    explorationRate: 0.5,
  };

  function setupBothPaths() {
    mockGetConfigValue.mockReturnValue(exploreCapable);
    mockLoadArtistWeights.mockResolvedValue(plexArtists);
    mockGetArtistTopTags.mockImplementation((name: string) =>
      Promise.resolve(genreByArtist[name] ?? tags)
    );
    mockGetArtistMbidByName.mockResolvedValue("mbid-seed");
    mockGetSimilarArtists.mockResolvedValue(similarArtists);
    mockFetchReleaseGroupsForArtist.mockImplementation((mbid: string) =>
      Promise.resolve(mbid === "mbid-jazz" ? jazzReleaseGroups : [])
    );
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockResolvedValue({ ok: true, data: [] });
  }

  it("explores when the coin lands under the exploration rate", async () => {
    setupBothPaths();

    const [result] = await getPromotedAlbums(userId, false, 1, {
      rng: seqRng([0.1]),
    });

    expect(result.mode).toBe("explore");
  });

  it("stays within taste when the coin lands above the exploration rate", async () => {
    setupBothPaths();

    const [result] = await getPromotedAlbums(userId, false, 1, {
      rng: seqRng([0.9, 0, 0]),
    });

    expect(result.mode).toBe("within_taste");
  });

  it("derives the deep page from the configured range", async () => {
    setupBothPaths();

    // range = deepPageMax - deepPageMin + 1 = 9; floor(0.5 * 9) + 2 = 6
    await getPromotedAlbums(userId, false, 1, {
      rng: seqRng([0.9, 0, 0.5, 0]),
    });

    expect(mockGetTopAlbumsByTag).toHaveBeenCalledWith(expect.any(String), "6");
  });

  it("serves the cache until the injected clock passes the TTL", async () => {
    setupBothPaths();
    const rng = () => 0.9;
    const base = 1_700_000_000_000;
    const ttlMs = exploreCapable.cacheDurationMinutes * 60 * 1000;

    await getPromotedAlbums(userId, false, 1, { rng, now: () => base });
    mockGetTopAlbumsByTag.mockClear();

    await getPromotedAlbums(userId, false, 1, {
      rng,
      now: () => base + ttlMs - 1,
    });
    expect(mockGetTopAlbumsByTag).not.toHaveBeenCalled();

    await getPromotedAlbums(userId, false, 1, {
      rng,
      now: () => base + ttlMs,
    });
    expect(mockGetTopAlbumsByTag).toHaveBeenCalled();
  });
});
