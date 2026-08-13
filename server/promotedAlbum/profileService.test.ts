import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PromotedAlbumConfig } from "../config";

const mockLoadArtistWeights = vi.fn();
const mockGetArtistTopTags = vi.fn();
const mockGetConfigValue = vi.fn();
const mockBuildSimilarGraph = vi.fn();

vi.mock("./artistWeights", () => ({
  loadArtistWeights: (...args: unknown[]) => mockLoadArtistWeights(...args),
}));

vi.mock("./explore", () => ({
  buildSimilarGraph: (...args: unknown[]) => mockBuildSimilarGraph(...args),
}));

vi.mock("../api/lastfm/artists", () => ({
  getArtistTopTags: (...args: unknown[]) => mockGetArtistTopTags(...args),
}));

vi.mock("../config", () => ({
  getConfigValue: (...args: unknown[]) => mockGetConfigValue(...args),
}));

import { regenerateProfile, loadFreshProfile } from "./profileService";
import { initializeDatabase, closeDatabase, getDataSource } from "../db";
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
  distributionWeight: 0,
  minPlaysForDistribution: 5,
};

const plexArtists = [
  { name: "Radiohead", viewCount: 100, thumb: "", genres: [] },
  { name: "Bjork", viewCount: 50, thumb: "", genres: [] },
];

const tags = [
  { name: "alternative", count: 100 },
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

let userId: number;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(Math, "random").mockReturnValue(0.1);
  mockGetConfigValue.mockReturnValue(baseConfig);
  mockLoadArtistWeights.mockResolvedValue(plexArtists);
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
        tag: "alternative",
        weight: 100 + 50,
        fromArtists: ["Radiohead", "Bjork"],
      },
    ]);
    expect(profile!.artistTags).toEqual([
      {
        name: "Radiohead",
        viewCount: 100,
        tags: [{ name: "alternative", count: 100 }],
      },
      {
        name: "Bjork",
        viewCount: 50,
        tags: [{ name: "alternative", count: 100 }],
      },
    ]);

    const row = await getUserProfile(userId);
    expect(row).not.toBeNull();
    expect(parseDerivedProfile(row!.profile_json).genreVector).toHaveLength(1);
  });

  it("gives artists of equal play weight equal influence however Last.fm tagged them", async () => {
    mockLoadArtistWeights.mockResolvedValue([
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
    mockLoadArtistWeights.mockResolvedValue([
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

  it("persists the play-distribution stats carried by the weight set", async () => {
    mockLoadArtistWeights.mockResolvedValue([
      {
        name: "Radiohead",
        viewCount: 60,
        distinctTracksPlayed: 4,
        topTrackShare: 0.4,
        distributionFactor: 0.8,
      },
    ]);
    mockGetArtistTopTags.mockResolvedValue(tags);

    const profile = await regenerateProfile(userId, "tok");

    expect(profile!.artistTags[0]).toMatchObject({
      name: "Radiohead",
      distinctTracksPlayed: 4,
      topTrackShare: 0.4,
      distributionFactor: 0.8,
    });

    const stored = parseDerivedProfile(
      (await getUserProfile(userId))!.profile_json
    );
    expect(stored.artistTags[0].distributionFactor).toBe(0.8);
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

describe("loadFreshProfile", () => {
  it("serves a fresh profile from the DB without re-fanning-out", async () => {
    await regenerateProfile(userId, "token");
    mockLoadArtistWeights.mockClear();
    mockGetArtistTopTags.mockClear();

    const profile = await loadFreshProfile(userId, "token", baseConfig);
    expect(profile!.genreVector).toHaveLength(1);
    expect(mockLoadArtistWeights).not.toHaveBeenCalled();
    expect(mockGetArtistTopTags).not.toHaveBeenCalled();
  });

  it("regenerates when the config hash no longer matches", async () => {
    await regenerateProfile(userId, "token");
    mockLoadArtistWeights.mockClear();

    const changedConfig = { ...baseConfig, tagsPerArtist: 2 };
    mockGetConfigValue.mockReturnValue(changedConfig);

    await loadFreshProfile(userId, "token", changedConfig);
    expect(mockLoadArtistWeights).toHaveBeenCalledTimes(1);
  });

  it("regenerates when the stored schema_version is stale", async () => {
    await regenerateProfile(userId, "token");
    await getDataSource().query(
      "UPDATE user_profiles SET schema_version = 0 WHERE user_id = ?",
      [userId]
    );
    mockLoadArtistWeights.mockClear();

    await loadFreshProfile(userId, "token", baseConfig);
    expect(mockLoadArtistWeights).toHaveBeenCalledTimes(1);
  });

  it("in-flight guard prevents concurrent double-regeneration", async () => {
    let resolveTop: (v: unknown) => void = () => {};
    mockLoadArtistWeights.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTop = resolve;
        })
    );

    const p1 = loadFreshProfile(userId, "token", baseConfig);
    const p2 = loadFreshProfile(userId, "token", baseConfig);

    await vi.waitFor(() =>
      expect(mockLoadArtistWeights).toHaveBeenCalledTimes(1)
    );
    resolveTop(plexArtists);
    await Promise.all([p1, p2]);

    expect(mockLoadArtistWeights).toHaveBeenCalledTimes(1);
  });
});
