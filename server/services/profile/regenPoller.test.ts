import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PromotedAlbumConfig } from "../../config";

const mockLoadSignalBundle = vi.fn();
const mockDeriveArtistWeights = vi.fn();
const mockDeriveAlbumWeights = vi.fn();
const mockGetArtistTopTags = vi.fn();
const mockGetConfigValue = vi.fn();
const mockBuildSimilarGraph = vi.fn().mockResolvedValue([]);

vi.mock("../../promotedAlbum/artistWeights", () => ({
  loadSignalBundle: async (...args: unknown[]) => {
    await mockLoadSignalBundle(...args);
    return { albumEvents: [] };
  },
  deriveArtistWeights: (...args: unknown[]) => mockDeriveArtistWeights(...args),
  deriveAlbumWeights: (...args: unknown[]) => mockDeriveAlbumWeights(...args),
}));

vi.mock("../../promotedAlbum/explore", () => ({
  buildSimilarGraph: (...args: unknown[]) => mockBuildSimilarGraph(...args),
}));

vi.mock("../../api/lastfm/artists", () => ({
  getArtistTopTags: (...args: unknown[]) => mockGetArtistTopTags(...args),
}));

vi.mock("../../config", () => ({
  getConfigValue: (...args: unknown[]) => mockGetConfigValue(...args),
}));

import { runProfileRegenOnce } from "./regenPoller";
import {
  regenerateProfile,
  loadFreshProfile,
} from "../../promotedAlbum/profileService";
import { initializeDatabase, closeDatabase, getDataSource } from "../../db";

const DAY_MS = 24 * 60 * 60 * 1000;

const baseConfig: PromotedAlbumConfig = {
  cacheDurationMinutes: 30,
  profileTtlMinutes: 1440,
  topArtistsCount: 10,
  pickedArtistsCount: 3,
  tagsPerArtist: 5,
  deepPageMin: 2,
  deepPageMax: 10,
  genericTags: [],
  libraryPreference: "prefer_new",
  explorationRate: 0,
  exploreCandidateCount: 12,
  genreOverlapThreshold: 0.15,
  backgroundRegenEnabled: true,
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
];
const tags = [{ name: "alternative rock", count: 100 }];

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

async function stampProfile(
  userId: number,
  generatedAtMs: number,
  lastUsedAtMs: number
): Promise<void> {
  await getDataSource().query(
    "UPDATE user_profiles SET generated_at = ?, last_used_at = ? WHERE user_id = ?",
    [
      new Date(generatedAtMs).toISOString(),
      new Date(lastUsedAtMs).toISOString(),
      userId,
    ]
  );
}

let now: number;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(Math, "random").mockReturnValue(0.1);
  mockGetConfigValue.mockReturnValue(baseConfig);
  mockLoadSignalBundle.mockResolvedValue(undefined);
  mockDeriveArtistWeights.mockReturnValue(plexArtists);
  mockDeriveAlbumWeights.mockReturnValue([]);
  mockGetArtistTopTags.mockResolvedValue(tags);
  await initializeDatabase(":memory:");
  now = Date.now();
});

afterEach(async () => {
  await closeDatabase();
  vi.restoreAllMocks();
});

describe("runProfileRegenOnce", () => {
  it("regenerates only stale and active profiles", async () => {
    const staleActive = await createUser("stale-active");
    const fresh = await createUser("fresh");
    const staleDormant = await createUser("stale-dormant");

    await regenerateProfile(staleActive, "stale-active");
    await regenerateProfile(fresh, "fresh");
    await regenerateProfile(staleDormant, "stale-dormant");

    await stampProfile(staleActive, now - 2 * DAY_MS, now);
    await stampProfile(fresh, now, now);
    await stampProfile(staleDormant, now - 2 * DAY_MS, now - 30 * DAY_MS);

    mockLoadSignalBundle.mockClear();
    await runProfileRegenOnce(now);

    expect(mockLoadSignalBundle).toHaveBeenCalledTimes(1);
    expect(mockLoadSignalBundle).toHaveBeenCalledWith(
      expect.any(Number),
      "stale-active"
    );
    expect(mockDeriveArtistWeights).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        windowMs: 90 * 24 * 60 * 60 * 1000,
        ratingWeight: 0.5,
      })
    );
  });

  it("does no work when the toggle is disabled", async () => {
    const userId = await createUser("stale-active");
    await regenerateProfile(userId, "stale-active");
    await stampProfile(userId, now - 2 * DAY_MS, now);

    mockGetConfigValue.mockReturnValue({
      ...baseConfig,
      backgroundRegenEnabled: false,
    });
    mockLoadSignalBundle.mockClear();

    await runProfileRegenOnce(now);
    expect(mockLoadSignalBundle).not.toHaveBeenCalled();
  });

  it("skips users without a profile row (never used discovery)", async () => {
    await createUser("no-profile");
    mockLoadSignalBundle.mockClear();

    await runProfileRegenOnce(now);
    expect(mockLoadSignalBundle).not.toHaveBeenCalled();
  });

  it("does not double-regenerate when a live request holds the in-flight guard", async () => {
    const userId = await createUser("stale-active");
    await regenerateProfile(userId, "stale-active");
    await stampProfile(userId, now - 2 * DAY_MS, now);

    let resolveTop: (v: unknown) => void = () => {};
    mockLoadSignalBundle.mockClear();
    mockLoadSignalBundle.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTop = resolve;
        })
    );

    const live = loadFreshProfile(userId, "stale-active", baseConfig);
    await vi.waitFor(() =>
      expect(mockLoadSignalBundle).toHaveBeenCalledTimes(1)
    );

    const tick = runProfileRegenOnce(now);
    resolveTop(plexArtists);
    await Promise.all([live, tick]);

    expect(mockLoadSignalBundle).toHaveBeenCalledTimes(1);
  });
});
