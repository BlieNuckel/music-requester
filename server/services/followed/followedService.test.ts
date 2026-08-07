import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFind = vi.fn();
const mockFindOne = vi.fn();
const mockCreate = vi.fn();
const mockSave = vi.fn();
const mockRemove = vi.fn();
const mockUpdate = vi.fn();
const mockQuery = vi.fn();

const mockReleaseFind = vi.fn();
const mockReleaseFindOne = vi.fn();
const mockReleaseCreate = vi.fn();
const mockReleaseSave = vi.fn();
const mockReleaseUpdate = vi.fn();

vi.mock("../../db/index", () => ({
  getDataSource: () => ({
    getRepository: (entity: string) => {
      if (entity === "FollowedRelease") {
        return {
          find: (...args: unknown[]) => mockReleaseFind(...args),
          findOne: (...args: unknown[]) => mockReleaseFindOne(...args),
          create: (...args: unknown[]) => mockReleaseCreate(...args),
          save: (...args: unknown[]) => mockReleaseSave(...args),
          update: (...args: unknown[]) => mockReleaseUpdate(...args),
        };
      }
      return {
        find: (...args: unknown[]) => mockFind(...args),
        findOne: (...args: unknown[]) => mockFindOne(...args),
        create: (...args: unknown[]) => mockCreate(...args),
        save: (...args: unknown[]) => mockSave(...args),
        remove: (...args: unknown[]) => mockRemove(...args),
        update: (...args: unknown[]) => mockUpdate(...args),
      };
    },
    query: (...args: unknown[]) => mockQuery(...args),
  }),
  FollowedArtist: "FollowedArtist",
  FollowedRelease: "FollowedRelease",
}));

vi.mock("../../logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

import {
  followArtist,
  unfollowArtist,
  getFollowedArtists,
  getAllFollowedArtists,
  findFollowedRelease,
  recordFollowedRelease,
  backfillReleaseMetadata,
  getFollowedReleasesForUser,
  updateLastCheckedAt,
  getUnseenReleaseCount,
  markFollowedReleasesViewed,
  markFollowedReleaseViewed,
  parseSecondaryTypes,
} from "./followedService";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("followArtist", () => {
  it("returns already_following when row exists", async () => {
    mockFindOne.mockResolvedValue({ id: 5 });
    const result = await followArtist(1, "mbid-1", "Artist");
    expect(result).toEqual({ status: "already_following", id: 5 });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates a new follow row", async () => {
    mockFindOne.mockResolvedValue(null);
    mockCreate.mockReturnValue({
      user_id: 1,
      artist_mbid: "mbid-1",
      artist_name: "Artist",
      last_checked_at: null,
    });
    mockSave.mockResolvedValue({ id: 10 });

    const result = await followArtist(1, "mbid-1", "Artist");
    expect(result).toEqual({ status: "added", id: 10 });
    expect(mockCreate).toHaveBeenCalledWith({
      user_id: 1,
      artist_mbid: "mbid-1",
      artist_name: "Artist",
      last_checked_at: null,
    });
  });
});

describe("unfollowArtist", () => {
  it("returns not_found when missing", async () => {
    mockFindOne.mockResolvedValue(null);
    const result = await unfollowArtist(1, "mbid-1");
    expect(result).toEqual({ status: "not_found" });
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("removes existing follow", async () => {
    const item = { id: 5, artist_name: "Artist" };
    mockFindOne.mockResolvedValue(item);
    const result = await unfollowArtist(1, "mbid-1");
    expect(result).toEqual({ status: "removed" });
    expect(mockRemove).toHaveBeenCalledWith(item);
  });
});

describe("getFollowedArtists", () => {
  it("returns rows for user ordered by created_at DESC", async () => {
    mockFind.mockResolvedValue([]);
    const result = await getFollowedArtists(1);
    expect(result).toEqual([]);
    expect(mockFind).toHaveBeenCalledWith({
      where: { user_id: 1 },
      order: { created_at: "DESC" },
    });
  });
});

describe("getAllFollowedArtists", () => {
  it("returns all rows ordered by created_at ASC", async () => {
    mockFind.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const result = await getAllFollowedArtists();
    expect(result).toHaveLength(2);
    expect(mockFind).toHaveBeenCalledWith({ order: { created_at: "ASC" } });
  });
});

describe("followed releases", () => {
  it("findFollowedRelease returns the row when it exists", async () => {
    const row = { id: 1, release_group_mbid: null };
    mockReleaseFindOne.mockResolvedValue(row);
    const result = await findFollowedRelease(1, "key-1");
    expect(result).toBe(row);
    expect(mockReleaseFindOne).toHaveBeenCalledWith({
      where: { followed_artist_id: 1, release_key: "key-1" },
    });
  });

  it("findFollowedRelease returns null when row missing", async () => {
    mockReleaseFindOne.mockResolvedValue(null);
    const result = await findFollowedRelease(1, "key-1");
    expect(result).toBeNull();
  });

  it("recordFollowedRelease inserts a row with JSON secondary types", async () => {
    mockReleaseCreate.mockImplementation((input) => input);
    mockReleaseSave.mockImplementation(async (input) => ({ ...input, id: 7 }));

    const result = await recordFollowedRelease({
      followed_artist_id: 1,
      release_key: "key-1",
      album_title: "Album",
      release_date: "2025-01-01",
      release_group_mbid: "rg-1",
      cover_url: "https://example.com/cover.jpg",
      release_type: "Album",
      secondary_types: ["Live"],
    });

    expect(result.id).toBe(7);
    expect(mockReleaseCreate).toHaveBeenCalledWith({
      followed_artist_id: 1,
      release_key: "key-1",
      album_title: "Album",
      release_date: "2025-01-01",
      release_group_mbid: "rg-1",
      cover_url: "https://example.com/cover.jpg",
      release_type: "Album",
      secondary_types: '["Live"]',
    });
  });

  it("recordFollowedRelease keeps null secondary types as null", async () => {
    mockReleaseCreate.mockImplementation((input) => input);
    mockReleaseSave.mockImplementation(async (input) => ({ ...input, id: 8 }));

    await recordFollowedRelease({
      followed_artist_id: 1,
      release_key: "key-2",
      album_title: "Album",
      release_date: null,
      release_group_mbid: null,
      cover_url: null,
      release_type: null,
      secondary_types: null,
    });

    expect(mockReleaseCreate).toHaveBeenCalledWith(
      expect.objectContaining({ secondary_types: null })
    );
  });

  it("backfillReleaseMetadata updates MB-derived fields", async () => {
    mockReleaseUpdate.mockResolvedValue({});
    await backfillReleaseMetadata(4, {
      release_group_mbid: "rg-9",
      cover_url: "https://caa/rg-9",
      release_type: "EP",
      secondary_types: [],
    });
    expect(mockReleaseUpdate).toHaveBeenCalledWith(
      { id: 4 },
      {
        release_group_mbid: "rg-9",
        cover_url: "https://caa/rg-9",
        release_type: "EP",
        secondary_types: "[]",
      }
    );
  });

  it("getFollowedReleasesForUser runs join query with limit", async () => {
    mockQuery.mockResolvedValue([{ id: 1, artist_name: "A" }]);
    const result = await getFollowedReleasesForUser(3, 10);
    expect(result).toHaveLength(1);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [3, 10]);
    const sqlArg = mockQuery.mock.calls[0][0] as string;
    expect(sqlArg).toContain("followed_releases");
    expect(sqlArg).toContain("followed_artists");
  });
});

describe("parseSecondaryTypes", () => {
  it("parses a JSON array", () => {
    expect(parseSecondaryTypes('["Live","Remix"]')).toEqual(["Live", "Remix"]);
  });

  it("returns null for null input", () => {
    expect(parseSecondaryTypes(null)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseSecondaryTypes("{nope")).toBeNull();
  });
});

describe("updateLastCheckedAt", () => {
  it("calls update with new timestamp", async () => {
    mockUpdate.mockResolvedValue({});
    await updateLastCheckedAt(5, "2025-05-15T12:00:00.000Z");
    expect(mockUpdate).toHaveBeenCalledWith(
      { id: 5 },
      { last_checked_at: "2025-05-15T12:00:00.000Z" }
    );
  });
});

describe("getUnseenReleaseCount", () => {
  it("counts rows with viewed_at IS NULL", async () => {
    mockQuery.mockResolvedValue([{ count: 3 }]);
    const result = await getUnseenReleaseCount(7);
    expect(result).toBe(3);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [7]);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("followed_releases");
    expect(sql).toContain("viewed_at IS NULL");
  });

  it("returns 0 when no rows", async () => {
    mockQuery.mockResolvedValue([]);
    const result = await getUnseenReleaseCount(7);
    expect(result).toBe(0);
  });
});

describe("markFollowedReleasesViewed", () => {
  it("stamps viewed_at on all unviewed rows for the user", async () => {
    mockQuery.mockResolvedValue([]);
    await markFollowedReleasesViewed(9);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("UPDATE followed_releases");
    expect(sql).toContain("viewed_at IS NULL");
    expect(typeof params[0]).toBe("string");
    expect(params[1]).toBe(9);
  });
});

describe("markFollowedReleaseViewed", () => {
  it("returns false when the release doesn't belong to the user", async () => {
    mockQuery.mockResolvedValue([]);
    const result = await markFollowedReleaseViewed(1, 42);
    expect(result).toBe(false);
    expect(mockReleaseUpdate).not.toHaveBeenCalled();
  });

  it("stamps viewed_at when the release belongs to the user", async () => {
    mockQuery.mockResolvedValue([{ id: 42 }]);
    mockReleaseUpdate.mockResolvedValue({});
    const result = await markFollowedReleaseViewed(1, 42);
    expect(result).toBe(true);
    expect(mockReleaseUpdate).toHaveBeenCalledWith(
      { id: 42 },
      { viewed_at: expect.any(String) }
    );
  });
});
