import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PromotedAlbumConfig } from "../config";

const mockLoadArtistWeights = vi.fn();
const mockGetSimilarArtists = vi.fn();
const mockEnrichArtistsWithImages = vi.fn();
const mockLidarrGet = vi.fn();
const mockGetConfigValue = vi.fn();

vi.mock("../promotedAlbum/artistWeights", () => ({
  loadArtistWeights: (...args: unknown[]) => mockLoadArtistWeights(...args),
}));

vi.mock("../api/lastfm/artists", () => ({
  getSimilarArtists: (...args: unknown[]) => mockGetSimilarArtists(...args),
}));

vi.mock("../services/lastfm", () => ({
  enrichArtistsWithImages: (...args: unknown[]) =>
    mockEnrichArtistsWithImages(...args),
}));

vi.mock("../api/lidarr/get", () => ({
  lidarrGet: (...args: unknown[]) => mockLidarrGet(...args),
}));

vi.mock("../config", () => ({
  getConfigValue: (...args: unknown[]) => mockGetConfigValue(...args),
}));

import {
  getPromotedArtists,
  clearPromotedArtistsCache,
} from "./getPromotedArtists";
import { initializeDatabase, closeDatabase, getDataSource } from "../db";
import { VARIOUS_ARTISTS_MBID } from "../utils/artistFilter";

type SimilarArtist = {
  name: string;
  mbid: string;
  match: number;
  imageUrl: string;
};

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

const baseConfig: PromotedAlbumConfig = {
  cacheDurationMinutes: 30,
  profileTtlMinutes: 1440,
  topArtistsCount: 10,
  pickedArtistsCount: 2,
  tagsPerArtist: 3,
  deepPageMin: 2,
  deepPageMax: 10,
  genericTags: [],
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
  minAvailableTracksForDistribution: 0,
};

const TOP_ARTISTS = [
  { name: "Aphex Twin", viewCount: 100, thumb: "", genres: [] },
  { name: "Plaid", viewCount: 50, thumb: "", genres: [] },
  { name: "Autechre", viewCount: 25, thumb: "", genres: [] },
];

const SIMILAR: Record<string, SimilarArtist[]> = {
  "Aphex Twin": [
    { name: "Boards of Canada", mbid: "boc", match: 0.9, imageUrl: "" },
    { name: "Plaid", mbid: "pl", match: 0.8, imageUrl: "" },
  ],
  Plaid: [
    { name: "Boards of Canada", mbid: "boc", match: 0.95, imageUrl: "" },
    { name: "Tycho", mbid: "ty", match: 0.7, imageUrl: "" },
  ],
};

let userId: number;

beforeEach(async () => {
  vi.clearAllMocks();
  clearPromotedArtistsCache();
  vi.spyOn(Math, "random").mockReturnValue(0);

  mockGetConfigValue.mockReturnValue(baseConfig);
  mockLoadArtistWeights.mockResolvedValue(TOP_ARTISTS);
  mockGetSimilarArtists.mockImplementation((name: string) =>
    Promise.resolve(SIMILAR[name] ?? [])
  );
  mockEnrichArtistsWithImages.mockImplementation((artists: unknown) =>
    Promise.resolve(artists)
  );
  mockLidarrGet.mockResolvedValue({
    ok: true,
    data: [{ artistName: "Tycho", foreignArtistId: "ty" }],
  });

  await initializeDatabase(":memory:");
  userId = await createUserWithToken("token");
});

afterEach(async () => {
  await closeDatabase();
  vi.restoreAllMocks();
});

describe("getPromotedArtists", () => {
  it("returns null when the user has no stored Plex token", async () => {
    const rows = (await getDataSource().query(
      "INSERT INTO users (user_type, enabled) VALUES ('local', 1) RETURNING id"
    )) as { id: number }[];
    expect(await getPromotedArtists(rows[0].id)).toBeNull();
    expect(mockLoadArtistWeights).not.toHaveBeenCalled();
  });

  it("returns null when the user has no top artists", async () => {
    mockLoadArtistWeights.mockResolvedValue([]);
    expect(await getPromotedArtists(userId)).toBeNull();
  });

  it("loads artist weights from the plays series for this user", async () => {
    await getPromotedArtists(userId);
    expect(mockLoadArtistWeights).toHaveBeenCalledWith(userId, "token", {
      windowMs: 90 * 24 * 60 * 60 * 1000,
      ratingWeight: 0.5,
      distributionWeight: 0,
      minPlaysForDistribution: 5,
      minAvailableTracksForDistribution: 0,
    });
  });

  it("returns similar artists seeded from the top artists", async () => {
    const result = await getPromotedArtists(userId);
    expect(result).not.toBeNull();
    expect(result!.seedArtists).toEqual(["Aphex Twin", "Plaid"]);
    const names = result!.artists.map((a) => a.name).sort();
    expect(names).toEqual(["Boards of Canada", "Tycho"]);
  });

  it("excludes artists already in the user's top list", async () => {
    const result = await getPromotedArtists(userId);
    const names = result!.artists.map((a) => a.name);
    expect(names).not.toContain("Plaid");
  });

  it("dedupes by name and keeps the highest match", async () => {
    const result = await getPromotedArtists(userId);
    const boc = result!.artists.find((a) => a.name === "Boards of Canada");
    expect(boc?.match).toBe(0.95);
  });

  it("marks artists in the library", async () => {
    const result = await getPromotedArtists(userId);
    const tycho = result!.artists.find((a) => a.name === "Tycho");
    const boc = result!.artists.find((a) => a.name === "Boards of Canada");
    expect(tycho?.inLibrary).toBe(true);
    expect(boc?.inLibrary).toBe(false);
  });

  it("excludes Various Artists from the similar results", async () => {
    mockGetSimilarArtists.mockImplementation((name: string) =>
      Promise.resolve(
        name === "Aphex Twin"
          ? [
              {
                name: "Various Artists",
                mbid: VARIOUS_ARTISTS_MBID,
                match: 1,
                imageUrl: "",
              },
              {
                name: "Boards of Canada",
                mbid: "boc",
                match: 0.9,
                imageUrl: "",
              },
            ]
          : []
      )
    );

    const result = await getPromotedArtists(userId);
    expect(result!.artists.map((a) => a.name)).toEqual(["Boards of Canada"]);
  });

  it("returns null when no similar artists remain after exclusion", async () => {
    mockGetSimilarArtists.mockResolvedValue([
      { name: "Aphex Twin", mbid: "at", match: 0.9, imageUrl: "" },
    ]);
    expect(await getPromotedArtists(userId)).toBeNull();
  });

  it("caches results per user and recomputes on refresh", async () => {
    await getPromotedArtists(userId);
    await getPromotedArtists(userId);
    expect(mockLoadArtistWeights).toHaveBeenCalledTimes(1);

    await getPromotedArtists(userId, true);
    expect(mockLoadArtistWeights).toHaveBeenCalledTimes(2);
  });

  it("persists anti-repeat memory so a refresh avoids re-showing artists", async () => {
    const first = await getPromotedArtists(userId);
    const firstNames = new Set(first!.artists.map((a) => a.name.toLowerCase()));

    const row = await getDataSource().query(
      "SELECT profile_json FROM user_profiles WHERE user_id = ?",
      [userId]
    );
    const stored = JSON.parse(row[0].profile_json) as {
      explorationHistory: { artists: string[] };
    };
    for (const name of firstNames) {
      expect(stored.explorationHistory.artists).toContain(name);
    }
  });

  it("survives Lidarr being unavailable", async () => {
    mockLidarrGet.mockRejectedValue(new Error("down"));
    const result = await getPromotedArtists(userId);
    expect(result).not.toBeNull();
    expect(result!.artists.every((a) => a.inLibrary === false)).toBe(true);
  });
});
