import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PromotedAlbumConfig } from "../config";

const mockLoadSignalBundle = vi.fn();
const mockAlbumEvents = vi.fn();
const mockGetAlbumTopTags = vi.fn();
const mockDeriveArtistWeights = vi.fn();
const mockDeriveAlbumWeights = vi.fn();
const mockGetArtistTopTags = vi.fn();
const mockGetConfigValue = vi.fn();
const mockBuildSimilarGraph = vi.fn();

vi.mock("./artistWeights", () => ({
  loadSignalBundle: async (...args: unknown[]) => {
    await mockLoadSignalBundle(...args);
    return { albumEvents: mockAlbumEvents() };
  },
  deriveArtistWeights: (...args: unknown[]) => mockDeriveArtistWeights(...args),
  deriveAlbumWeights: (...args: unknown[]) => mockDeriveAlbumWeights(...args),
}));

vi.mock("./explore", () => ({
  buildSimilarGraph: (...args: unknown[]) => mockBuildSimilarGraph(...args),
}));

vi.mock("../api/lastfm/artists", () => ({
  getArtistTopTags: (...args: unknown[]) => mockGetArtistTopTags(...args),
}));

vi.mock("../api/lastfm/albums", () => ({
  getAlbumTopTags: (...args: unknown[]) => mockGetAlbumTopTags(...args),
}));

vi.mock("../config", () => ({
  getConfigValue: (...args: unknown[]) => mockGetConfigValue(...args),
}));

import {
  regenerateProfile,
  loadFreshProfile,
  loadProfileForRequest,
} from "./profileService";
import { initializeDatabase, closeDatabase, getDataSource } from "../db";
import { appendSignalEvent } from "../db/userProfile";
import { getUserProfile, updateExplorationHistory } from "../db/userProfile";
import { parseDerivedProfile } from "../db/userProfile";

const baseConfig: PromotedAlbumConfig = {
  cacheDurationMinutes: 30,
  profileTtlMinutes: 1440,
  topArtistsCount: 10,
  pickedArtistsCount: 3,
  tagsPerArtist: 5,
  deepPageMin: 2,
  deepPageMax: 10,
  genericTags: ["seen live"],
  libraryPreference: "prefer_new",
  explorationRate: 0,
  exploreCandidateCount: 12,
  genreOverlapThreshold: 0.15,
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
  { name: "seen live", count: 90 },
];

const sampleGraph = [
  {
    seedArtist: "Radiohead",
    seedMbid: "mbid-radiohead",
    seedGenres: ["alternative"],
    viewCount: 100,
    candidates: [
      {
        name: "Portishead",
        artistMbid: "mbid-portishead",
        score: 0.8,
        genres: ["trip hop"],
      },
    ],
  },
];

async function createUser(token: string): Promise<number> {
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

const DAY_MS = 24 * 60 * 60 * 1000;

let userId: number;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(Math, "random").mockReturnValue(0.1);
  mockGetConfigValue.mockReturnValue(baseConfig);
  mockLoadSignalBundle.mockResolvedValue(undefined);
  mockDeriveArtistWeights.mockReturnValue(plexArtists);
  mockDeriveAlbumWeights.mockReturnValue([]);
  mockAlbumEvents.mockReturnValue([]);
  mockGetAlbumTopTags.mockResolvedValue([]);
  mockGetArtistTopTags.mockResolvedValue(tags);
  mockBuildSimilarGraph.mockResolvedValue(sampleGraph);
  await initializeDatabase(":memory:");
  userId = await createUser("token");
});

afterEach(async () => {
  await closeDatabase();
  vi.restoreAllMocks();
});

describe("regenerateProfile", () => {
  it("builds and persists the genre vector and artist breakdown", async () => {
    const profile = await regenerateProfile(userId, "token");
    expect(profile).not.toBeNull();

    expect(profile!.genreVector).toEqual([
      {
        tag: "alternative rock",
        weight: 100 + 50,
        fromArtists: ["Radiohead", "Bjork"],
      },
    ]);
    expect(profile!.artistTags).toEqual([
      {
        name: "Radiohead",
        viewCount: 100,
        tags: [{ name: "alternative rock", count: 100 }],
      },
      {
        name: "Bjork",
        viewCount: 50,
        tags: [{ name: "alternative rock", count: 100 }],
      },
    ]);

    const row = await getUserProfile(userId);
    expect(row).not.toBeNull();
    expect(parseDerivedProfile(row!.profile_json).genreVector).toHaveLength(1);
  });

  it("persists a listening series for the artists it ranks", async () => {
    const now = Date.now();
    await appendSignalEvent(userId, "plex_listen_history", {
      episodes: [
        {
          ratingKey: "t1",
          title: "track",
          artistKey: "key-radiohead",
          artistName: "Radiohead",
          albumKey: "album",
          albumTitle: "Album",
          viewedAt: Math.floor((now - 3 * DAY_MS) / 1000),
          startedAt: now - 3 * DAY_MS,
          durationMs: 210_000,
          listenedMs: 210_000,
          measured: false,
        },
      ],
    });

    const profile = await regenerateProfile(userId, "token");

    const radiohead = profile!.artistSeries.find((s) => s.name === "Radiohead");
    expect(radiohead).toBeDefined();
    expect(radiohead!.bucketMs).toBe(baseConfig.seriesBucketDays * DAY_MS);
    expect(radiohead!.plays).toHaveLength(baseConfig.seriesSpanDays / 7);
    const last = radiohead!.plays.length - 1;
    expect(radiohead!.plays[last]).toBe(1);
    expect(radiohead!.listenedMs[last]).toBe(210_000);

    const stored = parseDerivedProfile(
      (await getUserProfile(userId))!.profile_json
    );
    expect(stored.artistSeries.map((s) => s.name)).toContain("Radiohead");
  });

  it("leaves the series empty when nothing has been listened to", async () => {
    const profile = await regenerateProfile(userId, "token");
    expect(profile!.artistSeries).toEqual([]);
  });

  it("fetches tags for every top artist rather than a random few", async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      name: `Artist ${i}`,
      viewCount: 100 - i,
    }));
    mockDeriveArtistWeights.mockReturnValue(many);
    mockGetArtistTopTags.mockImplementation((name: string) =>
      Promise.resolve([
        {
          name: GENRE_FIXTURES[
            Number(name.split(" ")[1]) % GENRE_FIXTURES.length
          ],
          count: 100,
        },
      ])
    );

    const profile = await regenerateProfile(userId, "token");

    expect(mockGetArtistTopTags).toHaveBeenCalledTimes(8);
    expect(profile!.artistTags).toHaveLength(8);
    expect(profile!.genreVector).toHaveLength(8);
  });

  it("still caps the artists it covers at topArtistsCount", async () => {
    mockGetConfigValue.mockReturnValue({ ...baseConfig, topArtistsCount: 3 });
    mockDeriveArtistWeights.mockReturnValue(
      Array.from({ length: 8 }, (_, i) => ({
        name: `Artist ${i}`,
        viewCount: 100 - i,
      }))
    );

    const profile = await regenerateProfile(userId, "token");

    expect(profile!.artistTags.map((a) => a.name)).toEqual([
      "Artist 0",
      "Artist 1",
      "Artist 2",
    ]);
  });

  it("gives artists of equal play weight equal influence however Last.fm tagged them", async () => {
    mockDeriveArtistWeights.mockReturnValue([
      { name: "Broadly Tagged", viewCount: 100 },
      { name: "Thinly Tagged", viewCount: 100 },
    ]);
    mockGetArtistTopTags.mockImplementation((name: string) =>
      Promise.resolve(
        name === "Broadly Tagged"
          ? [
              { name: "shoegaze", count: 100 },
              { name: "dream pop", count: 90 },
              { name: "noise", count: 80 },
            ]
          : [
              { name: "techno", count: 100 },
              { name: "minimal", count: 5 },
            ]
      )
    );

    const profile = await regenerateProfile(userId, "token");

    const massOf = (artist: string) =>
      profile!.genreVector
        .filter((g) => g.fromArtists.includes(artist))
        .reduce((sum, g) => sum + g.weight, 0);
    expect(massOf("Broadly Tagged")).toBeCloseTo(100);
    expect(massOf("Thinly Tagged")).toBeCloseTo(100);
  });

  it("keeps an artist in the vector when every tag count is zero", async () => {
    mockDeriveArtistWeights.mockReturnValue([
      { name: "Untagged", viewCount: 60 },
    ]);
    mockGetArtistTopTags.mockResolvedValue([
      { name: "drone", count: 0 },
      { name: "ambient", count: 0 },
    ]);

    const profile = await regenerateProfile(userId, "token");

    expect(profile!.genreVector).toEqual([
      { tag: "drone", weight: 30, fromArtists: ["Untagged"] },
      { tag: "ambient", weight: 30, fromArtists: ["Untagged"] },
    ]);
  });

  it("persists the albums the user already listens to", async () => {
    await appendSignalEvent(userId, "plex_track_plays", {
      tracks: [
        {
          ratingKey: "1",
          title: "Alison",
          artistKey: "ak",
          artistName: "Slowdive",
          albumKey: "alb-1",
          albumTitle: "Souvlaki",
          playCount: 12,
        },
      ],
    });

    const profile = await regenerateProfile(userId, "token");

    expect(profile!.knownAlbums).toEqual(["slowdive::souvlaki"]);
    const stored = parseDerivedProfile(
      (await getUserProfile(userId))!.profile_json
    );
    expect(stored.knownAlbums).toEqual(["slowdive::souvlaki"]);
  });

  it("builds and persists the similar-artist graph from the top artists", async () => {
    const profile = await regenerateProfile(userId, "token");
    expect(mockBuildSimilarGraph).toHaveBeenCalledWith(plexArtists, baseConfig);
    expect(profile!.similarGraph).toEqual(sampleGraph);

    const row = await getUserProfile(userId);
    expect(parseDerivedProfile(row!.profile_json).similarGraph).toEqual(
      sampleGraph
    );
  });

  it("returns null and leaves no vector when every tag is generic", async () => {
    mockGetArtistTopTags.mockResolvedValue([{ name: "seen live", count: 90 }]);
    expect(await regenerateProfile(userId, "token")).toBeNull();
    expect(await getUserProfile(userId)).toBeNull();
  });

  it("carries existing exploration memory forward across a regenerate", async () => {
    await updateExplorationHistory(userId, {
      albums: ["alb-x"],
      artists: ["art-y"],
    });

    const profile = await regenerateProfile(userId, "token");
    expect(profile!.explorationHistory).toEqual({
      albums: ["alb-x"],
      artists: ["art-y"],
    });
  });
});

describe("regenerateProfile album genres", () => {
  function albumRollup(
    albumKey: string,
    artistName: string,
    playCount: number
  ) {
    return {
      albumKey,
      title: albumKey,
      artistKey: `ak-${artistName}`,
      artistName,
      playCount,
      listenedMs: playCount * 210_000,
    };
  }

  function catalogueEvent(albums: { ratingKey: string; genres: string[] }[]) {
    return [
      {
        payload: JSON.stringify({
          albums: albums.map((a) => ({
            ratingKey: a.ratingKey,
            title: a.ratingKey,
            artistKey: "ak-Radiohead",
            artistName: "Radiohead",
            trackCount: 10,
            genres: a.genres,
          })),
        }),
        recorded_at: "2026-01-01T00:00:00.000Z",
      },
    ];
  }

  it("stores each album with its share of the artist's weight", async () => {
    mockDeriveArtistWeights.mockReturnValue([
      { name: "Radiohead", viewCount: 100 },
    ]);
    mockDeriveAlbumWeights.mockReturnValue([
      albumRollup("kid-a", "Radiohead", 8),
      albumRollup("in-rainbows", "Radiohead", 2),
    ]);

    const profile = await regenerateProfile(userId, "token");

    expect(profile!.albumTags.map((a) => [a.albumKey, a.weight])).toEqual([
      ["kid-a", 80],
      ["in-rainbows", 20],
    ]);
  });

  it("lets one record's own genre into the vector without dragging the artist along", async () => {
    mockDeriveArtistWeights.mockReturnValue([
      { name: "Radiohead", viewCount: 100 },
    ]);
    mockDeriveAlbumWeights.mockReturnValue([
      albumRollup("kid-a", "Radiohead", 9),
      albumRollup("unplugged", "Radiohead", 1),
    ]);
    mockGetArtistTopTags.mockResolvedValue([
      { name: "alternative rock", count: 100 },
    ]);
    mockAlbumEvents.mockReturnValue(
      catalogueEvent([{ ratingKey: "unplugged", genres: ["Folk"] }])
    );

    const profile = await regenerateProfile(userId, "token");

    expect(profile!.genreVector).toEqual([
      { tag: "alternative rock", weight: 90, fromArtists: ["Radiohead"] },
      { tag: "folk", weight: 10, fromArtists: ["Radiohead"] },
    ]);
  });

  it("prefers a Last.fm album tag over the Plex genre", async () => {
    mockDeriveArtistWeights.mockReturnValue([
      { name: "Radiohead", viewCount: 100 },
    ]);
    mockDeriveAlbumWeights.mockReturnValue([
      albumRollup("kid-a", "Radiohead", 10),
    ]);
    mockAlbumEvents.mockReturnValue(
      catalogueEvent([{ ratingKey: "kid-a", genres: ["Rock"] }])
    );
    mockGetAlbumTopTags.mockResolvedValue([{ name: "art rock", count: 100 }]);

    const profile = await regenerateProfile(userId, "token");

    expect(mockGetAlbumTopTags).toHaveBeenCalledWith("Radiohead", "kid-a");
    expect(profile!.albumTags[0]).toMatchObject({
      source: "lastfm-album",
      tags: [{ name: "art rock", count: 100 }],
    });
  });

  it("spends album lookups only on the most-listened albums per artist", async () => {
    mockGetConfigValue.mockReturnValue({
      ...baseConfig,
      albumTagsPerArtist: 1,
    });
    mockDeriveArtistWeights.mockReturnValue([
      { name: "Radiohead", viewCount: 100 },
    ]);
    mockDeriveAlbumWeights.mockReturnValue([
      albumRollup("kid-a", "Radiohead", 9),
      albumRollup("amnesiac", "Radiohead", 1),
    ]);

    await regenerateProfile(userId, "token");

    expect(mockGetAlbumTopTags).toHaveBeenCalledTimes(1);
    expect(mockGetAlbumTopTags).toHaveBeenCalledWith("Radiohead", "kid-a");
  });

  it("spends nothing on Last.fm when the album lookup knob is off", async () => {
    mockGetConfigValue.mockReturnValue({
      ...baseConfig,
      albumTagsPerArtist: 0,
    });
    mockDeriveAlbumWeights.mockReturnValue([
      albumRollup("kid-a", "Radiohead", 9),
    ]);

    await regenerateProfile(userId, "token");

    expect(mockGetAlbumTopTags).not.toHaveBeenCalled();
  });

  it("keeps an artist whose listening lands on no album in the vector", async () => {
    mockDeriveArtistWeights.mockReturnValue([
      { name: "Radiohead", viewCount: 100 },
    ]);
    mockDeriveAlbumWeights.mockReturnValue([]);
    mockGetArtistTopTags.mockResolvedValue([
      { name: "alternative rock", count: 100 },
    ]);

    const profile = await regenerateProfile(userId, "token");

    expect(profile!.genreVector).toEqual([
      { tag: "alternative rock", weight: 100, fromArtists: ["Radiohead"] },
    ]);
    expect(profile!.albumTags[0]).toMatchObject({
      albumKey: "",
      source: "artist",
    });
  });
});

describe("loadFreshProfile", () => {
  it("serves a fresh profile from the DB without re-fanning-out", async () => {
    await regenerateProfile(userId, "token");
    mockLoadSignalBundle.mockClear();
    mockGetArtistTopTags.mockClear();

    const profile = await loadFreshProfile(userId, "token", baseConfig);
    expect(profile!.genreVector).toHaveLength(1);
    expect(mockLoadSignalBundle).not.toHaveBeenCalled();
    expect(mockGetArtistTopTags).not.toHaveBeenCalled();
  });

  it("regenerates when the config hash no longer matches", async () => {
    await regenerateProfile(userId, "token");
    mockLoadSignalBundle.mockClear();

    const changedConfig = { ...baseConfig, tagsPerArtist: 2 };
    mockGetConfigValue.mockReturnValue(changedConfig);

    await loadFreshProfile(userId, "token", changedConfig);
    expect(mockLoadSignalBundle).toHaveBeenCalledTimes(1);
  });

  it("regenerates when the stored schema_version is stale", async () => {
    await regenerateProfile(userId, "token");
    await getDataSource().query(
      "UPDATE user_profiles SET schema_version = 0 WHERE user_id = ?",
      [userId]
    );
    mockLoadSignalBundle.mockClear();

    await loadFreshProfile(userId, "token", baseConfig);
    expect(mockLoadSignalBundle).toHaveBeenCalledTimes(1);
  });

  it("serves the stored profile when a regeneration produces no genres", async () => {
    await regenerateProfile(userId, "token");
    await getDataSource().query(
      "UPDATE user_profiles SET schema_version = 0 WHERE user_id = ?",
      [userId]
    );
    mockGetArtistTopTags.mockResolvedValue([{ name: "seen live", count: 90 }]);

    const profile = await loadFreshProfile(userId, "token", baseConfig);

    expect(profile!.genreVector).toEqual([
      {
        tag: "alternative rock",
        weight: 150,
        fromArtists: ["Radiohead", "Bjork"],
      },
    ]);
  });

  it("returns null when a regeneration produces no genres and nothing is stored", async () => {
    mockGetArtistTopTags.mockResolvedValue([{ name: "seen live", count: 90 }]);

    expect(await loadFreshProfile(userId, "token", baseConfig)).toBeNull();
  });

  it("in-flight guard prevents concurrent double-regeneration", async () => {
    let resolveTop: (v: unknown) => void = () => {};
    mockLoadSignalBundle.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTop = resolve;
        })
    );

    const p1 = loadFreshProfile(userId, "token", baseConfig);
    const p2 = loadFreshProfile(userId, "token", baseConfig);

    await vi.waitFor(() =>
      expect(mockLoadSignalBundle).toHaveBeenCalledTimes(1)
    );
    resolveTop(plexArtists);
    await Promise.all([p1, p2]);

    expect(mockLoadSignalBundle).toHaveBeenCalledTimes(1);
  });
});

describe("loadProfileForRequest", () => {
  it("reports building and schedules the build when nothing is stored", async () => {
    const load = await loadProfileForRequest(userId, "token", baseConfig);

    expect(load).toEqual({ status: "building" });
    await vi.waitFor(() =>
      expect(mockLoadSignalBundle).toHaveBeenCalledWith(userId, "token")
    );
  });

  it("serves a fresh profile without scheduling a build", async () => {
    await regenerateProfile(userId, "token");
    mockLoadSignalBundle.mockClear();

    const load = await loadProfileForRequest(userId, "token", baseConfig);

    expect(load.status).toBe("ready");
    expect(mockLoadSignalBundle).not.toHaveBeenCalled();
  });

  it("serves a stale profile rather than blocking on its rebuild", async () => {
    await regenerateProfile(userId, "token");
    await getDataSource().query(
      "UPDATE user_profiles SET schema_version = 0 WHERE user_id = ?",
      [userId]
    );

    const load = await loadProfileForRequest(userId, "token", baseConfig);

    expect(load.status).toBe("ready");
    expect(load.status === "ready" && load.profile.genreVector).toHaveLength(1);
  });
});
