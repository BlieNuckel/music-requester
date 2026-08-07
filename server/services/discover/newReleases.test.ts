import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetFollowedReleases = vi.fn();
const mockGetCachedFeed = vi.fn();
const mockGetArtistList = vi.fn();
const mockGetUserProfile = vi.fn();
const mockEnrich = vi.fn();

vi.mock("./feedCache", () => ({
  getCachedFreshReleases: (...args: unknown[]) => mockGetCachedFeed(...args),
}));

vi.mock("../followed/followedService", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../followed/followedService")>();
  return {
    ...original,
    getFollowedReleasesForUser: (...args: unknown[]) =>
      mockGetFollowedReleases(...args),
  };
});

vi.mock("../lidarr/artists", () => ({
  getArtistList: (...args: unknown[]) => mockGetArtistList(...args),
}));

vi.mock("../requests/lidarrEnrichment", () => ({
  enrichRequestsWithLidarr: (...args: unknown[]) => mockEnrich(...args),
}));

vi.mock("../../db/userProfile", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../db/userProfile")>();
  return {
    ...original,
    getUserProfile: (...args: unknown[]) => mockGetUserProfile(...args),
  };
});

vi.mock("../../logger", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

import { getNewReleases } from "./newReleases";

const NOW = Date.parse("2026-07-09T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function followedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    followed_artist_id: 1,
    artist_name: "Followed Artist",
    artist_mbid: "mbid-followed",
    release_key: "album|2026-07",
    album_title: "Followed Album",
    release_date: daysAgo(5),
    release_group_mbid: "rg-followed",
    cover_url: "https://caa/rg-followed",
    release_type: "Album",
    secondary_types: "[]",
    viewed_at: null,
    notified_at: "2026-07-05T00:00:00.000Z",
    ...overrides,
  };
}

function feedRelease(overrides: Record<string, unknown> = {}) {
  return {
    artistName: "Library Artist",
    artistMbids: ["mbid-library"],
    releaseName: "Library Album",
    releaseDate: daysAgo(10),
    releaseGroupMbid: "rg-library",
    primaryType: "Album",
    secondaryType: null,
    ...overrides,
  };
}

function profileWithSimilar(mbids: string[]) {
  return {
    profile_json: JSON.stringify({
      genreVector: [],
      artistTags: [],
      similarGraph: [
        {
          seedArtist: "Seed",
          seedMbid: "mbid-seed",
          seedGenres: [],
          viewCount: 10,
          candidates: mbids.map((m, i) => ({
            name: `Similar ${i}`,
            artistMbid: m,
            score: 100,
            genres: [],
          })),
        },
      ],
      explorationHistory: { albums: [], artists: [] },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetFollowedReleases.mockResolvedValue([]);
  mockGetCachedFeed.mockResolvedValue([]);
  mockGetArtistList.mockResolvedValue({ ok: true, data: [] });
  mockGetUserProfile.mockResolvedValue(null);
  mockEnrich.mockImplementation(async (mbids: string[]) =>
    mbids.map(() => null)
  );
});

describe("getNewReleases", () => {
  it("returns empty items when there is nothing anywhere", async () => {
    const result = await getNewReleases(1, NOW);
    expect(result.items).toEqual([]);
    expect(result.windowDays).toBe(90);
  });

  it("maps followed releases with source and followedReleaseId", async () => {
    mockGetFollowedReleases.mockResolvedValue([followedRow()]);

    const result = await getNewReleases(1, NOW);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      releaseGroupMbid: "rg-followed",
      title: "Followed Album",
      artistName: "Followed Artist",
      artistMbid: "mbid-followed",
      releaseDate: daysAgo(5),
      source: "followed",
      coverUrl: "https://caa/rg-followed",
      lidarrStatus: null,
      followedReleaseId: 1,
    });
  });

  it("includes library-artist releases from the feed", async () => {
    mockGetArtistList.mockResolvedValue({
      ok: true,
      data: [
        { id: 1, name: "Library Artist", foreignArtistId: "mbid-library" },
      ],
    });
    mockGetCachedFeed.mockResolvedValue([feedRelease()]);

    const result = await getNewReleases(1, NOW);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].source).toBe("library");
    expect(result.items[0].coverUrl).toBe(
      "https://coverartarchive.org/release-group/rg-library/front-500"
    );
    expect(result.items[0].followedReleaseId).toBeNull();
  });

  it("includes similar-artist releases from the user profile graph", async () => {
    mockGetUserProfile.mockResolvedValue(profileWithSimilar(["mbid-similar"]));
    mockGetCachedFeed.mockResolvedValue([
      feedRelease({
        artistName: "Similar Artist",
        artistMbids: ["mbid-similar"],
        releaseGroupMbid: "rg-similar",
      }),
    ]);

    const result = await getNewReleases(1, NOW);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].source).toBe("similar");
  });

  it("skips the similar tier when no profile exists", async () => {
    mockGetCachedFeed.mockResolvedValue([
      feedRelease({ artistMbids: ["mbid-similar"] }),
    ]);

    const result = await getNewReleases(1, NOW);
    expect(result.items).toEqual([]);
  });

  it("filters noisy release types from feed and followed tiers", async () => {
    mockGetFollowedReleases.mockResolvedValue([
      followedRow({ secondary_types: '["Live"]' }),
    ]);
    mockGetArtistList.mockResolvedValue({
      ok: true,
      data: [{ id: 1, name: "A", foreignArtistId: "mbid-library" }],
    });
    mockGetCachedFeed.mockResolvedValue([
      feedRelease({ secondaryType: "Remix", releaseGroupMbid: "rg-remix" }),
      feedRelease({ primaryType: "Broadcast", releaseGroupMbid: "rg-bc" }),
      feedRelease({ secondaryType: "Soundtrack", releaseGroupMbid: "rg-ost" }),
    ]);

    const result = await getNewReleases(1, NOW);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].releaseGroupMbid).toBe("rg-ost");
  });

  it("prefers the followed entry when the same release appears in the feed", async () => {
    mockGetFollowedReleases.mockResolvedValue([followedRow()]);
    mockGetArtistList.mockResolvedValue({
      ok: true,
      data: [{ id: 1, name: "A", foreignArtistId: "mbid-followed" }],
    });
    mockGetCachedFeed.mockResolvedValue([
      feedRelease({
        artistMbids: ["mbid-followed"],
        releaseGroupMbid: "rg-followed",
        releaseName: "Followed Album",
      }),
    ]);

    const result = await getNewReleases(1, NOW);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].source).toBe("followed");
  });

  it("dedupes a pre-backfill followed item against its feed twin by title", async () => {
    mockGetFollowedReleases.mockResolvedValue([
      followedRow({
        release_group_mbid: null,
        cover_url: "https://deezer/cover.jpg",
        artist_name: "Library Artist",
        album_title: "Library Album",
        release_date: daysAgo(10),
      }),
    ]);
    mockGetArtistList.mockResolvedValue({
      ok: true,
      data: [{ id: 1, name: "A", foreignArtistId: "mbid-library" }],
    });
    mockGetCachedFeed.mockResolvedValue([feedRelease()]);

    const result = await getNewReleases(1, NOW);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].source).toBe("followed");
    expect(result.items[0].releaseGroupMbid).toBeNull();
  });

  it("widens the window until six items exist and reports it", async () => {
    mockGetArtistList.mockResolvedValue({
      ok: true,
      data: [{ id: 1, name: "A", foreignArtistId: "mbid-library" }],
    });
    mockGetCachedFeed.mockResolvedValue([
      ...[1, 2, 3].map((i) =>
        feedRelease({
          releaseGroupMbid: `rg-recent-${i}`,
          releaseName: `Recent ${i}`,
          releaseDate: daysAgo(i),
        })
      ),
      ...[1, 2, 3].map((i) =>
        feedRelease({
          releaseGroupMbid: `rg-older-${i}`,
          releaseName: `Older ${i}`,
          releaseDate: daysAgo(40 + i),
        })
      ),
    ]);

    const result = await getNewReleases(1, NOW);
    expect(result.windowDays).toBe(60);
    expect(result.items).toHaveLength(6);
  });

  it("keeps a 30-day window when it already has six items", async () => {
    mockGetArtistList.mockResolvedValue({
      ok: true,
      data: [{ id: 1, name: "A", foreignArtistId: "mbid-library" }],
    });
    mockGetCachedFeed.mockResolvedValue(
      [1, 2, 3, 4, 5, 6, 7].map((i) =>
        feedRelease({
          releaseGroupMbid: `rg-${i}`,
          releaseName: `Fresh ${i}`,
          releaseDate: daysAgo(i),
        })
      )
    );

    const result = await getNewReleases(1, NOW);
    expect(result.windowDays).toBe(30);
    expect(result.items).toHaveLength(6);
  });

  it("excludes unreleased (future-dated) and windowless releases", async () => {
    mockGetArtistList.mockResolvedValue({
      ok: true,
      data: [{ id: 1, name: "A", foreignArtistId: "mbid-library" }],
    });
    mockGetCachedFeed.mockResolvedValue([
      feedRelease({ releaseGroupMbid: "rg-future", releaseDate: daysAgo(-3) }),
      feedRelease({ releaseGroupMbid: "rg-undated", releaseDate: null }),
      feedRelease({
        releaseGroupMbid: "rg-ancient",
        releaseDate: daysAgo(200),
      }),
    ]);

    const result = await getNewReleases(1, NOW);
    expect(result.items).toEqual([]);
  });

  it("puts unseen followed releases first, then newest", async () => {
    mockGetFollowedReleases.mockResolvedValue([
      followedRow({
        id: 1,
        release_group_mbid: "rg-seen",
        album_title: "Seen Followed",
        release_date: daysAgo(1),
        viewed_at: "2026-07-08T00:00:00.000Z",
        release_key: "seenfollowed|2026-07",
      }),
      followedRow({
        id: 2,
        release_group_mbid: "rg-unseen",
        album_title: "Unseen Followed",
        release_date: daysAgo(20),
        viewed_at: null,
        release_key: "unseenfollowed|2026-06",
      }),
    ]);
    mockGetArtistList.mockResolvedValue({
      ok: true,
      data: [{ id: 1, name: "A", foreignArtistId: "mbid-library" }],
    });
    mockGetCachedFeed.mockResolvedValue([
      feedRelease({ releaseGroupMbid: "rg-lib", releaseDate: daysAgo(2) }),
    ]);

    const result = await getNewReleases(1, NOW);
    expect(result.items.map((i) => i.releaseGroupMbid)).toEqual([
      "rg-unseen",
      "rg-seen",
      "rg-lib",
    ]);
  });

  it("caps the shelf at six with unseen-followed priority", async () => {
    mockGetFollowedReleases.mockResolvedValue([
      followedRow({
        id: 9,
        release_group_mbid: "rg-unseen",
        album_title: "Unseen",
        release_date: daysAgo(25),
        release_key: "unseen|2026-06",
      }),
    ]);
    mockGetArtistList.mockResolvedValue({
      ok: true,
      data: [{ id: 1, name: "A", foreignArtistId: "mbid-library" }],
    });
    mockGetCachedFeed.mockResolvedValue(
      [1, 2, 3, 4, 5, 6].map((i) =>
        feedRelease({
          releaseGroupMbid: `rg-${i}`,
          releaseName: `Fresh ${i}`,
          releaseDate: daysAgo(i),
        })
      )
    );

    const result = await getNewReleases(1, NOW);
    expect(result.items).toHaveLength(6);
    expect(result.items[0].releaseGroupMbid).toBe("rg-unseen");
  });

  it("attaches lidarr status to items with MBIDs", async () => {
    mockGetFollowedReleases.mockResolvedValue([followedRow()]);
    mockEnrich.mockResolvedValue([
      { status: "imported", downloadProgress: null },
    ]);

    const result = await getNewReleases(1, NOW);
    expect(mockEnrich).toHaveBeenCalledWith(["rg-followed"]);
    expect(result.items[0].lidarrStatus).toBe("imported");
  });

  it("treats a Lidarr failure as empty library tier", async () => {
    mockGetArtistList.mockResolvedValue({
      ok: false,
      error: "down",
      status: 500,
    });
    mockGetCachedFeed.mockResolvedValue([feedRelease()]);

    const result = await getNewReleases(1, NOW);
    expect(result.items).toEqual([]);
  });
});
