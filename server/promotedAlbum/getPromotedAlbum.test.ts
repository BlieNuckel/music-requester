import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PromotedAlbumConfig } from "../config";

const mockLoadSignalBundle = vi.fn();
const mockDeriveArtistWeights = vi.fn();
const mockDeriveAlbumWeights = vi.fn();
const mockGetArtistTopTags = vi.fn();
const mockGetTopAlbumsByTag = vi.fn();
const mockGetAlbumTopTags = vi.fn();
const mockLidarrGet = vi.fn();
const mockResolveReleaseGroupInfo = vi.fn();
const mockFetchReleaseGroupsForArtist = vi.fn();
const mockGetConfigValue = vi.fn();
const mockGetSimilarArtists = vi.fn();
const mockGetArtistMbidByName = vi.fn();
/** Captures the context the runtime hands a node, which is how config reaches one now. */
const mockNodeCtx = vi.fn();

/**
 * The build is a graph run now, so the seam is a node body rather than a module export.
 */
vi.mock("./profileGraph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./profileGraph")>();
  return {
    ...actual,
    PROFILE_BODIES: new Map([
      ...actual.PROFILE_BODIES,
      [
        "loadSignals",
        async (_i: unknown, ctx: { userId: number; plexToken: string }) => {
          await mockLoadSignalBundle(ctx.userId, ctx.plexToken);
          const { getSignalEvents } = await import("../db/userProfile");
          return {
            trackEvents: await getSignalEvents(ctx.userId, "plex_track_plays"),
            ratingEvents: await getSignalEvents(ctx.userId, "plex_rating"),
            albumEvents: [],
            episodes: new Map(),
          };
        },
      ],
      [
        "attachSeries",
        (_i: unknown, ctx: unknown) => {
          mockNodeCtx(ctx);
          return mockDeriveArtistWeights();
        },
      ],
      [
        "albumListening",
        () =>
          (mockDeriveAlbumWeights() as { playCount: number }[]).map(
            (album) => ({
              ...album,
              plays: album.playCount,
              distinctTracksPlayed: 1,
            })
          ),
      ],
    ]),
  };
});

vi.mock("../api/lastfm/artists", () => ({
  getArtistTopTags: (...args: unknown[]) => mockGetArtistTopTags(...args),
}));

vi.mock("../api/lastfm/albums", () => ({
  getTopAlbumsByTag: (...args: unknown[]) => mockGetTopAlbumsByTag(...args),
  getAlbumTopTags: (...args: unknown[]) => mockGetAlbumTopTags(...args),
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

import {
  getPromotedAlbums,
  clearPromotedAlbumCache,
  listWarmableUsers,
  promotedAlbumCacheExpiry,
  type PromotedAlbumDeps,
} from "./getPromotedAlbum";
import { loadFreshProfile } from "./profileService";
import { invalidateArtistList } from "../services/lidarr/artists";
import { invalidateMonitoredAlbums } from "../services/lidarr/albums";
import { findUserById } from "../auth/users";
import { initializeDatabase, closeDatabase, getDataSource } from "../db";
import type { WithinTasteResult, ExploreResult, PersonalResult } from "./types";

/**
 * Await the profile build that the request path now only schedules, so a case can assert on
 * recommendations instead of the "building" state a first-ever load returns. Mirrors what a
 * real second request sees once the background build has landed.
 */
async function seedProfile(userId: number) {
  const user = await findUserById(userId);
  if (!user?.plexToken) return;
  await loadFreshProfile(
    userId,
    user.plexToken,
    mockGetConfigValue("promotedAlbum") as PromotedAlbumConfig
  );
}

/** The albums half of the carousel payload; the `status` half has its own cases. */
async function getAlbums(
  userId: number,
  forceRefresh = false,
  count?: number,
  deps?: PromotedAlbumDeps
) {
  await seedProfile(userId);
  const { albums } = await getPromotedAlbums(userId, forceRefresh, count, deps);
  return albums;
}

/**
 * Deterministic but varying randomness, for cases that need successive draws to differ.
 * The suite otherwise pins `Math.random` to one value, which would make every pick's
 * artist sample identical.
 */
function lcg(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** Single-pick view of the carousel batch, so per-selection cases stay readable. */
async function getOne(userId: number, forceRefresh = false) {
  const [first] = await getAlbums(userId, forceRefresh, 1);
  return first ?? null;
}

/** Narrows a result to within-taste; the suite forces this via explorationRate: 0. */
function wt(result: Awaited<ReturnType<typeof getOne>>): WithinTasteResult {
  if (!result || result.mode !== "within_taste") {
    throw new Error("expected a within_taste result");
  }
  return result;
}

function pe(result: Awaited<ReturnType<typeof getOne>>): PersonalResult {
  if (!result || result.mode !== "personal") {
    throw new Error("expected a personal result");
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
  listeningWeight: 1,
  maxTrackMinutesForWeight: 0,
  seriesBucketDays: 7,
  seriesSpanDays: 182,
  momentumRecentBuckets: 4,
  albumTagsPerArtist: 4,
};

let userId: number;

beforeEach(async () => {
  vi.clearAllMocks();
  clearPromotedAlbumCache();
  invalidateArtistList();
  invalidateMonitoredAlbums();
  vi.spyOn(Math, "random").mockReturnValue(0.1);
  mockGetConfigValue.mockReturnValue(defaultPromotedAlbumConfig);
  mockLoadSignalBundle.mockResolvedValue(undefined);
  mockDeriveAlbumWeights.mockReturnValue([]);
  mockGetAlbumTopTags.mockResolvedValue([]);
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

/** Real MusicBrainz genres — the classifier drops anything the vocabulary doesn't know. */
const GENRE_FIXTURES = [
  "shoegaze",
  "dream pop",
  "techno",
  "drone",
  "ambient",
  "jazz",
  "funk",
  "disco",
];

const tags = [
  { name: "alternative rock", count: 100 },
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
    { name: "alternative rock", count: 100 },
    { name: "rock", count: 80 },
  ],
  "Rock Clone": [
    { name: "alternative rock", count: 100 },
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
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
    expect(wt(result).tag).toBe("alternative rock");
    expect(result!.inLibrary).toBe(false);
    expect(mockLoadSignalBundle).toHaveBeenCalledWith(
      expect.any(Number),
      "test-plex-token"
    );
    expect(mockNodeCtx).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        config: expect.objectContaining({
          playTrendWindowDays: expect.any(Number),
        }),
      })
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
    expect(mockLoadSignalBundle).not.toHaveBeenCalled();
  });

  it("fetches both page 1 and a deep page of tag albums", async () => {
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
    mockDeriveArtistWeights.mockReturnValue([]);

    const result = await getOne(userId);
    expect(result).toBeNull();
  });

  it("returns null when all tags are generic", async () => {
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue([
      { name: "seen live", count: 100 },
      { name: "favorites", count: 80 },
    ]);

    const result = await getOne(userId);
    expect(result).toBeNull();
  });

  it("handles tag fetch failures gracefully", async () => {
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
    mockGetArtistTopTags.mockRejectedValue(new Error("API error"));

    const result = await getOne(userId);
    expect(result).toBeNull();
  });

  it("filters albums without MBIDs", async () => {
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

    const first = await getOne(userId);
    mockLoadSignalBundle.mockClear();
    mockGetTopAlbumsByTag.mockClear();

    const second = await getOne(userId);
    expect(second).toEqual(first);
    expect(mockLoadSignalBundle).not.toHaveBeenCalled();
    expect(mockGetTopAlbumsByTag).not.toHaveBeenCalled();
  });

  it("caches results per user — different users get independent results", async () => {
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

    const userA = await createUserWithToken("user-a-token");
    const userB = await createUserWithToken("user-b-token");

    await getOne(userA);
    mockLoadSignalBundle.mockClear();

    await getOne(userB);
    expect(mockLoadSignalBundle).toHaveBeenCalledWith(
      expect.any(Number),
      "user-b-token"
    );
  });

  it("force refresh re-selects an album without re-running the fan-out", async () => {
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

    await getOne(userId);
    mockLoadSignalBundle.mockClear();
    mockGetTopAlbumsByTag.mockClear();

    await getOne(userId, true);
    expect(mockLoadSignalBundle).not.toHaveBeenCalled();
    expect(mockGetTopAlbumsByTag).toHaveBeenCalled();
  });

  describe("warm builds", () => {
    beforeEach(() => {
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });
    });

    it("counts a real load as activity worth warming later", async () => {
      await getOne(userId);

      expect(listWarmableUsers()).toContain(userId);
    });

    it("does not let a warm build renew its own reason to run", async () => {
      await getAlbums(userId, true, 1, { source: "warmer" });

      expect(listWarmableUsers()).not.toContain(userId);
    });

    it("resolves on the background lane so live page loads keep priority", async () => {
      await getAlbums(userId, true, 1, { source: "warmer" });

      expect(mockResolveReleaseGroupInfo).toHaveBeenCalledWith(
        expect.any(String),
        "background"
      );
    });

    it("resolves a real load on the interactive lane", async () => {
      await getOne(userId);

      expect(mockResolveReleaseGroupInfo).toHaveBeenCalledWith(
        expect.any(String),
        "interactive"
      );
    });

    it("exposes when a cached carousel expires, and nothing once cleared", async () => {
      await getOne(userId);
      expect(promotedAlbumCacheExpiry(userId)).toBeGreaterThan(Date.now());

      clearPromotedAlbumCache();
      expect(promotedAlbumCacheExpiry(userId)).toBeUndefined();
    });
  });

  it("falls back gracefully when Lidarr is unavailable", async () => {
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockRejectedValue(new Error("Connection refused"));

    const result = await getOne(userId);
    expect(result).not.toBeNull();
    expect(result!.inLibrary).toBe(false);
  });

  it("treats all as not in library when Lidarr returns ok: false", async () => {
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockResolvedValue({ ok: false, status: 500, data: {} });

    const result = await getOne(userId);
    expect(result).not.toBeNull();
    expect(result!.inLibrary).toBe(false);
  });

  it("re-selects an album after the result cache expires, without re-fanning-out", async () => {
    vi.useFakeTimers();
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

    await getOne(userId);
    mockLoadSignalBundle.mockClear();
    mockGetTopAlbumsByTag.mockClear();

    vi.advanceTimersByTime(31 * 60 * 1000);
    await getOne(userId);
    expect(mockLoadSignalBundle).not.toHaveBeenCalled();
    expect(mockGetTopAlbumsByTag).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("serves the stale profile once the profile TTL expires instead of blocking on a rebuild", async () => {
    vi.useFakeTimers();
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

    await getOne(userId);
    clearPromotedAlbumCache();

    vi.advanceTimersByTime((1440 + 1) * 60 * 1000);
    const stale = await getPromotedAlbums(userId, true, 1);

    expect(stale.status).toBe("ready");
    expect(stale.albums).toHaveLength(1);

    vi.useRealTimers();
  });

  it("reports building until the profile exists, then serves it", async () => {
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

    const first = await getPromotedAlbums(userId, false, 1);
    expect(first).toEqual({ status: "building", albums: [] });

    // The build the first call scheduled runs off-request; it is what fills the carousel.
    await vi.waitFor(async () => {
      const next = await getPromotedAlbums(userId, true, 1);
      expect(next.status).toBe("ready");
      expect(next.albums).toHaveLength(1);
    });
  });

  it("reports ready rather than building when the user has no Plex token", async () => {
    const tokenlessId = (
      (await getDataSource().query(
        "INSERT INTO users (user_type, enabled) VALUES ('local', 1) RETURNING id"
      )) as { id: number }[]
    )[0].id;

    expect(await getPromotedAlbums(tokenlessId)).toEqual({
      status: "ready",
      albums: [],
    });
  });

  it("respects custom result-cache duration from config", async () => {
    vi.useFakeTimers();
    mockGetConfigValue.mockReturnValue({
      ...defaultPromotedAlbumConfig,
      cacheDurationMinutes: 5,
    });
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
    mockLidarrGet.mockResolvedValue({ ok: true, data: [] });
    mockResolveReleaseGroupInfo.mockResolvedValue(null);

    const result = await getOne(userId);
    expect(result).toBeNull();
  });

  describe("anti-repeat", () => {
    it("avoids re-showing the most recent album on refresh", async () => {
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
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

      const results = await getAlbums(userId, false, 2);

      expect(results.map((r) => r.album.mbid)).toEqual(["rg-alb-2"]);
    });

    it("resolves only the preferred candidates, not the whole pool", async () => {
      const libraryHeavyPage = {
        albums: [
          ...Array.from({ length: 20 }, (_, i) => ({
            name: `Owned ${i}`,
            mbid: `owned-${i}`,
            artistName: "Radiohead",
            artistMbid: "art-owned",
          })),
          {
            name: "Unowned",
            mbid: "unowned-1",
            artistName: "Bjork",
            artistMbid: "art-new",
          },
        ],
        pagination: { page: 1, totalPages: 1 },
      };
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(libraryHeavyPage);
      mockLidarrGet.mockImplementation((path: string) =>
        Promise.resolve(
          path === "/artist"
            ? { ok: true, data: [{ foreignArtistId: "art-owned" }] }
            : { ok: true, data: [] }
        )
      );

      const result = await getOne(userId);

      expect(result!.album.artistMbid).toBe("art-new");
      expect(mockResolveReleaseGroupInfo).toHaveBeenCalledTimes(1);
    });

    it("gives up on a pick rather than resolving an unbounded pool", async () => {
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue({
        albums: Array.from({ length: 60 }, (_, i) => ({
          name: `Dead ${i}`,
          mbid: `dead-${i}`,
          artistName: "Radiohead",
          artistMbid: "art-1",
        })),
        pagination: { page: 1, totalPages: 1 },
      });
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });
      mockResolveReleaseGroupInfo.mockResolvedValue(null);

      expect(await getOne(userId)).toBeNull();
      expect(mockResolveReleaseGroupInfo.mock.calls.length).toBeLessThanOrEqual(
        30
      );
    });

    it("returns nothing when every candidate is a live album or compilation", async () => {
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albums);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });
    }

    it("returns five distinct albums by default", async () => {
      mockHappyPath();

      const results = await getAlbums(userId);
      expect(results).toHaveLength(5);
      expect(new Set(results.map((r) => r.album.mbid)).size).toBe(5);
    });

    it("returns the requested number of albums", async () => {
      mockHappyPath();

      const results = await getAlbums(userId, false, 3);
      expect(results).toHaveLength(3);
    });

    it("returns a shorter batch when the pool cannot fill it", async () => {
      mockHappyPath(albumsPage);

      const results = await getAlbums(userId, false, 5);
      expect(results).toHaveLength(2);
      expect(new Set(results.map((r) => r.album.mbid)).size).toBe(2);
    });

    it("returns an empty list when nothing can be built", async () => {
      mockDeriveArtistWeights.mockReturnValue([]);

      const results = await getAlbums(userId);
      expect(results).toEqual([]);
    });

    it("serves the whole batch from cache on the next call", async () => {
      mockHappyPath();

      const first = await getAlbums(userId);
      mockGetTopAlbumsByTag.mockClear();

      const second = await getAlbums(userId);
      expect(second).toEqual(first);
      expect(mockGetTopAlbumsByTag).not.toHaveBeenCalled();
    });

    it("rebuilds when the cached batch is smaller than the requested count", async () => {
      mockHappyPath();

      await getAlbums(userId, false, 1);
      mockGetTopAlbumsByTag.mockClear();

      const results = await getAlbums(userId, false, 4);
      expect(results).toHaveLength(4);
      expect(mockGetTopAlbumsByTag).toHaveBeenCalled();
    });

    it("remembers every album in the batch for anti-repeat", async () => {
      mockHappyPath();

      const first = await getAlbums(userId, false, 3);
      const second = await getAlbums(userId, true, 3);

      const firstMbids = new Set(first.map((r) => r.album.mbid));
      expect(second).toHaveLength(3);
      for (const result of second) {
        expect(firstMbids.has(result.album.mbid)).toBe(false);
      }
    });

    it("re-samples the artists per pick so one batch spans the profile", async () => {
      const wide = Array.from({ length: 8 }, (_, i) => ({
        name: `Artist ${i}`,
        viewCount: 100,
      }));
      mockDeriveArtistWeights.mockReturnValue(wide);
      mockGetArtistTopTags.mockImplementation((name: string) =>
        Promise.resolve([
          { name: GENRE_FIXTURES[Number(name.split(" ")[1])], count: 100 },
        ])
      );
      mockGetTopAlbumsByTag.mockResolvedValue(bigAlbumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const results = await getAlbums(userId, false, 5, { rng: lcg(42) });

      const sampledPerPick = results.map((r) =>
        wt(r)
          .trace.plexArtists.filter((a) => a.picked)
          .map((a) => a.name)
          .sort()
          .join(",")
      );
      expect(new Set(sampledPerPick).size).toBeGreaterThan(1);
    });
  });

  describe("trace", () => {
    it("has correct number of plexArtists entries", async () => {
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const result = await getOne(userId);
      const picked = wt(result).trace.plexArtists.filter((a) => a.picked);
      expect(picked).toHaveLength(2);
    });

    it("marks only the artists this pick sampled, and lists the rest", async () => {
      mockDeriveArtistWeights.mockReturnValue(
        Array.from({ length: 6 }, (_, i) => ({
          name: `Artist ${i}`,
          viewCount: 100,
        }))
      );
      mockGetArtistTopTags.mockImplementation((name: string) =>
        Promise.resolve([
          { name: GENRE_FIXTURES[Number(name.split(" ")[1])], count: 100 },
        ])
      );
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const result = await getOne(userId);
      const trace = wt(result).trace;

      expect(trace.plexArtists).toHaveLength(6);
      expect(trace.plexArtists.filter((a) => a.picked)).toHaveLength(3);
      // The vector shown is the one this pick drew from, not the whole profile's.
      expect(trace.weightedTags).toHaveLength(3);
      expect(trace.weightedTags.map((t) => t.name)).toContain(
        trace.chosenTag.name
      );
    });

    it("falls back to the stored vector for a profile with no artist tags", async () => {
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      await seedProfile(userId);
      const row = await getDataSource().query(
        "SELECT profile_json FROM user_profiles WHERE user_id = ?",
        [userId]
      );
      const stored = JSON.parse(
        (row as { profile_json: string }[])[0].profile_json
      );
      await getDataSource().query(
        "UPDATE user_profiles SET profile_json = ? WHERE user_id = ?",
        [JSON.stringify({ ...stored, artistTags: [] }), userId]
      );
      clearPromotedAlbumCache();

      const { albums } = await getPromotedAlbums(userId, true, 1);

      expect(albums).toHaveLength(1);
      expect(wt(albums[0]).tag).toBe("alternative rock");
    });

    it("falls back to artist tags when every stored album resolved to no genre", async () => {
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      await seedProfile(userId);
      const row = await getDataSource().query(
        "SELECT profile_json FROM user_profiles WHERE user_id = ?",
        [userId]
      );
      const stored = JSON.parse(
        (row as { profile_json: string }[])[0].profile_json
      );
      const genreless = stored.albumTags.map(
        (album: Record<string, unknown>) => ({
          ...album,
          tags: [],
          otherTags: [
            { name: "nigerian", canonical: "Nigeria", class: "region" },
          ],
        })
      );
      await getDataSource().query(
        "UPDATE user_profiles SET profile_json = ? WHERE user_id = ?",
        [JSON.stringify({ ...stored, albumTags: genreless }), userId]
      );
      clearPromotedAlbumCache();

      const { albums } = await getPromotedAlbums(userId, true, 1);

      expect(albums).toHaveLength(1);
      expect(wt(albums[0]).tag).toBe("alternative rock");
    });

    it("chosenTag name matches result tag", async () => {
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const result = await getOne(userId);
      expect(wt(result).trace.chosenTag.name).toBe(wt(result).tag);
    });

    it("albumPool counts are accurate", async () => {
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const result = await getOne(userId);
      expect(result!.trace.selectionReason).toBe("preferred_non_library");
    });

    it("selectionReason is fallback_in_library when all artists are in library", async () => {
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const result = await getOne(userId);
      const altTag = wt(result).trace.weightedTags.find(
        (t) => t.name === "alternative rock"
      );
      expect(altTag).toBeDefined();
      expect(altTag!.fromArtists).toContain("Radiohead");
      expect(altTag!.fromArtists).toContain("Bjork");
      const share = 100 / (100 + 80);
      expect(altTag!.weight).toBeCloseTo(share * 100 + share * 50);
    });

    it("picked artists have tagContributions populated", async () => {
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const result = await getOne(userId);
      const radiohead = wt(result).trace.plexArtists.find(
        (a) => a.name === "Radiohead"
      );
      expect(radiohead!.tagContributions).toHaveLength(2);
      expect(radiohead!.tagContributions[0].tagName).toBe("alternative rock");
    });
  });

  describe("config-driven behavior", () => {
    it("derives the play-trend window from playTrendWindowDays", async () => {
      mockGetConfigValue.mockReturnValue({
        ...defaultPromotedAlbumConfig,
        playTrendWindowDays: 30,
      });
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      await getOne(userId);
      expect(mockNodeCtx).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ playTrendWindowDays: 30 }),
        })
      );
    });

    it("passes ratingWeight from config to the weight source", async () => {
      mockGetConfigValue.mockReturnValue({
        ...defaultPromotedAlbumConfig,
        ratingWeight: 1.0,
      });
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      await getOne(userId);
      expect(mockNodeCtx).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ ratingWeight: 1.0 }),
        })
      );
    });

    it("uses custom genericTags from config", async () => {
      mockGetConfigValue.mockReturnValue({
        ...defaultPromotedAlbumConfig,
        genericTags: ["alternative rock"],
      });
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const result = await getOne(userId);
      if (result) {
        expect(wt(result).tag).toBe("rock");
      }
    });

    it("draws the pick's tag from the sampled artist's albums", async () => {
      mockGetConfigValue.mockReturnValue({
        ...defaultPromotedAlbumConfig,
        pickedArtistsCount: 1,
        albumTagsPerArtist: 1,
      });
      mockDeriveArtistWeights.mockReturnValue([
        { name: "Radiohead", viewCount: 100, thumb: "", genres: [] },
      ]);
      mockDeriveAlbumWeights.mockReturnValue([
        {
          albumKey: "unplugged",
          title: "Unplugged",
          artistKey: "ak-Radiohead",
          artistName: "Radiohead",
          playCount: 10,
          listenedMs: 2_100_000,
        },
      ]);
      mockGetAlbumTopTags.mockResolvedValue([{ name: "folk", count: 100 }]);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const result = await getOne(userId);

      expect(wt(result).tag).toBe("folk");
    });

    it("attributes the trace's tag contributions to the artist the album belongs to", async () => {
      mockGetConfigValue.mockReturnValue({
        ...defaultPromotedAlbumConfig,
        pickedArtistsCount: 1,
        albumTagsPerArtist: 1,
      });
      mockDeriveArtistWeights.mockReturnValue([
        { name: "Radiohead", viewCount: 100, thumb: "", genres: [] },
      ]);
      mockDeriveAlbumWeights.mockReturnValue([
        {
          albumKey: "unplugged",
          title: "Unplugged",
          artistKey: "ak-Radiohead",
          artistName: "Radiohead",
          playCount: 10,
          listenedMs: 2_100_000,
        },
      ]);
      mockGetAlbumTopTags.mockResolvedValue([{ name: "folk", count: 100 }]);
      mockGetArtistTopTags.mockResolvedValue(tags);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);
      mockLidarrGet.mockResolvedValue({ ok: true, data: [] });

      const result = await getOne(userId);

      const [artist] = wt(result).trace.plexArtists;
      expect(artist.name).toBe("Radiohead");
      expect(artist.tagContributions).toEqual([
        { tagName: "folk", rawCount: 100, weight: 100 },
      ]);
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

      mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
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
      mockDeriveArtistWeights.mockReturnValue(plexArtists);
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

    it("falls back to the personal source when no candidate is a different genre", async () => {
      setupExplore();
      mockGetArtistTopTags.mockResolvedValue(genreByArtist["Radiohead"]);
      mockGetTopAlbumsByTag.mockResolvedValue(albumsPage);

      const result = await getOne(userId);
      expect(pe(result).mode).toBe("personal");
      expect(pe(result).album.artistName).toBe("Jazz Cat");
    });

    it("falls back to the tag path when neither graph source yields an album", async () => {
      setupExplore();
      mockGetArtistTopTags.mockResolvedValue(genreByArtist["Radiohead"]);
      mockFetchReleaseGroupsForArtist.mockResolvedValue([]);
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
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
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

    const [result] = await getAlbums(userId, false, 1, {
      rng: seqRng([0.1]),
    });

    expect(result.mode).toBe("explore");
  });

  it("stays within taste when the coin lands above the exploration rate", async () => {
    setupBothPaths();

    const [result] = await getAlbums(userId, false, 1, {
      rng: seqRng([0.9, 0, 0]),
    });

    expect(result.mode).toBe("within_taste");
  });

  it("spends the exploration rate as a share of the carousel, not a coin per pick", async () => {
    setupBothPaths();
    const twoEach = (prefix: string, artist: string, mbid: string) => [
      {
        id: `${prefix}-1`,
        score: 1,
        title: `${artist} One`,
        "primary-type": "Album",
        "first-release-date": "1990-01-01",
        "artist-credit": [{ name: artist, artist: { id: mbid, name: artist } }],
      },
      {
        id: `${prefix}-2`,
        score: 1,
        title: `${artist} Two`,
        "primary-type": "Album",
        "first-release-date": "1992-01-01",
        "artist-credit": [{ name: artist, artist: { id: mbid, name: artist } }],
      },
    ];
    mockFetchReleaseGroupsForArtist.mockImplementation((mbid: string) =>
      Promise.resolve(
        mbid === "mbid-jazz"
          ? twoEach("rg-jazz", "Jazz Cat", "mbid-jazz")
          : twoEach("rg-rock", "Rock Clone", "mbid-rock")
      )
    );

    // explorationRate 0.5 over 4 picks = exactly 2 genre jumps, no coin per pick.
    const albums = await getAlbums(userId, false, 4, { rng: seqRng([0.2]) });

    expect(albums).toHaveLength(4);
    expect(albums.filter((a) => a.mode === "explore")).toHaveLength(2);
    expect(albums.filter((a) => a.mode === "personal")).toHaveLength(2);
  });

  it("derives the deep page from the configured range", async () => {
    setupBothPaths();

    // Draws in order: explore coin, one per personal candidate drawn, one per sampled
    // artist, tag, deep page. range = deepPageMax - deepPageMin + 1 = 9; floor(0.5*9)+2 = 6
    await getAlbums(userId, false, 1, {
      rng: seqRng([0.9, 0, 0, 0, 0, 0.5, 0]),
    });

    expect(mockGetTopAlbumsByTag).toHaveBeenCalledWith(expect.any(String), "6");
  });

  it("serves the cache until the injected clock passes the TTL", async () => {
    setupBothPaths();
    const rng = () => 0.9;
    const base = 1_700_000_000_000;
    const ttlMs = exploreCapable.cacheDurationMinutes * 60 * 1000;

    await getAlbums(userId, false, 1, { rng, now: () => base });
    mockGetTopAlbumsByTag.mockClear();

    await getAlbums(userId, false, 1, {
      rng,
      now: () => base + ttlMs - 1,
    });
    expect(mockGetTopAlbumsByTag).not.toHaveBeenCalled();

    await getAlbums(userId, false, 1, {
      rng,
      now: () => base + ttlMs,
    });
    expect(mockGetTopAlbumsByTag).toHaveBeenCalled();
  });
});

describe("resilience", () => {
  const base = 1_700_000_000_000;
  const ttlMs = defaultPromotedAlbumConfig.cacheDurationMinutes * 60 * 1000;
  const throttled = new Error("MusicBrainz returned 503");

  /** Tag-chart path only: an empty similar graph keeps the personal source out of it. */
  function setupPool(page: typeof albumsPage = bigAlbumsPage) {
    mockDeriveArtistWeights.mockReturnValue(plexArtists);
    mockGetArtistTopTags.mockResolvedValue(tags);
    mockGetTopAlbumsByTag.mockResolvedValue(page);
    mockLidarrGet.mockResolvedValue({ ok: true, data: [] });
    mockGetSimilarArtists.mockResolvedValue([]);
    mockFetchReleaseGroupsForArtist.mockResolvedValue([]);
    mockGetArtistMbidByName.mockResolvedValue(null);
  }

  it("keeps the rest of the carousel when one candidate lookup throws", async () => {
    setupPool();
    mockResolveReleaseGroupInfo.mockImplementation((mbid: string) =>
      mbid === "alb-1"
        ? Promise.reject(throttled)
        : Promise.resolve({
            id: `rg-${mbid}`,
            firstReleaseDate: "1997-06-16",
            primaryType: "Album",
            secondaryTypes: [],
          })
    );

    const results = await getAlbums(userId);

    expect(results).toHaveLength(5);
    expect(results.map((r) => r.album.mbid)).not.toContain("rg-alb-1");
  });

  it("reports ready with nothing rather than throwing when every lookup fails", async () => {
    setupPool();
    mockResolveReleaseGroupInfo.mockRejectedValue(throttled);

    await seedProfile(userId);

    expect(await getPromotedAlbums(userId)).toEqual({
      status: "ready",
      albums: [],
    });
  });

  it("serves the stored carousel after a restart instead of rebuilding it", async () => {
    setupPool();

    const first = await getAlbums(userId, false, 5, { now: () => base });
    clearPromotedAlbumCache();
    mockGetTopAlbumsByTag.mockClear();

    const second = await getAlbums(userId, false, 5, {
      now: () => base + 60_000,
    });

    expect(second).toEqual(first);
    expect(mockGetTopAlbumsByTag).not.toHaveBeenCalled();
  });

  it("rebuilds rather than serving a stored carousel past its TTL", async () => {
    setupPool();

    await getAlbums(userId, false, 5, { now: () => base });
    clearPromotedAlbumCache();
    mockGetTopAlbumsByTag.mockClear();

    await getAlbums(userId, false, 5, { now: () => base + ttlMs + 1 });

    expect(mockGetTopAlbumsByTag).toHaveBeenCalled();
  });

  it("falls back to the stored carousel when the rebuild fails", async () => {
    setupPool();
    const first = await getAlbums(userId, false, 5, { now: () => base });

    clearPromotedAlbumCache();
    mockResolveReleaseGroupInfo.mockRejectedValue(throttled);
    const second = await getAlbums(userId, false, 5, {
      now: () => base + ttlMs + 1,
    });

    expect(second).toEqual(first);
  });

  it("has nothing to fall back to before a first successful build", async () => {
    setupPool();
    mockGetTopAlbumsByTag.mockRejectedValue(throttled);

    expect(await getAlbums(userId, false, 5, { now: () => base })).toEqual([]);
  });

  it("retries a shortfall on a later load rather than on the next one", async () => {
    setupPool(albumsPage);

    const first = await getAlbums(userId, false, 5, { now: () => base });
    expect(first).toHaveLength(2);
    mockGetTopAlbumsByTag.mockClear();

    await getAlbums(userId, false, 5, { now: () => base + 60_000 });
    expect(mockGetTopAlbumsByTag).not.toHaveBeenCalled();

    await getAlbums(userId, false, 5, { now: () => base + 6 * 60_000 });
    expect(mockGetTopAlbumsByTag).toHaveBeenCalled();
  });

  it("re-tries only after the short window when a stale batch was served", async () => {
    setupPool();
    await getAlbums(userId, false, 5, { now: () => base });

    clearPromotedAlbumCache();
    mockResolveReleaseGroupInfo.mockRejectedValue(throttled);
    const failedAt = base + ttlMs + 1;
    await getAlbums(userId, false, 5, { now: () => failedAt });
    mockGetTopAlbumsByTag.mockClear();

    await getAlbums(userId, false, 5, { now: () => failedAt + 60_000 });
    expect(mockGetTopAlbumsByTag).not.toHaveBeenCalled();

    await getAlbums(userId, false, 5, { now: () => failedAt + 6 * 60_000 });
    expect(mockGetTopAlbumsByTag).toHaveBeenCalled();
  });

  it("stores the batch a warm build produced, so the next visitor gets it", async () => {
    setupPool();

    await getAlbums(userId, true, 5, { now: () => base, source: "warmer" });
    clearPromotedAlbumCache();
    mockGetTopAlbumsByTag.mockClear();

    const served = await getAlbums(userId, false, 5, {
      now: () => base + 60_000,
    });

    expect(served).toHaveLength(5);
    expect(mockGetTopAlbumsByTag).not.toHaveBeenCalled();
  });
});
