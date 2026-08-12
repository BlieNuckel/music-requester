import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAll = vi.fn();
const mockFindRelease = vi.fn();
const mockRecord = vi.fn();
const mockBackfill = vi.fn();
const mockUpdateChecked = vi.fn();
const mockAggregate = vi.fn();
const mockNotifyRelease = vi.fn();

vi.mock("./followedService", () => ({
  getAllFollowedArtists: () => mockGetAll(),
  findFollowedRelease: (...args: unknown[]) => mockFindRelease(...args),
  recordFollowedRelease: (...args: unknown[]) => mockRecord(...args),
  backfillReleaseMetadata: (...args: unknown[]) => mockBackfill(...args),
  updateLastCheckedAt: (...args: unknown[]) => mockUpdateChecked(...args),
}));

vi.mock("./releaseAggregator", () => ({
  aggregateArtistReleases: (...args: unknown[]) => mockAggregate(...args),
}));

vi.mock("../notifications", () => ({
  notifyFollowedRelease: (...args: unknown[]) => mockNotifyRelease(...args),
}));

vi.mock("../../logger", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

import { runPollOnce } from "./poller";

function makeAggregated(overrides: Record<string, unknown> = {}) {
  return {
    release_key: "key-1",
    source: "musicbrainz",
    album_title: "New Album",
    release_date: "2025-04-01",
    release_group_mbid: "rg-1",
    cover_url: "https://caa/rg-1",
    release_type: "Album",
    secondary_types: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runPollOnce", () => {
  it("records new releases for established follows", async () => {
    mockGetAll.mockResolvedValue([
      {
        id: 1,
        user_id: 10,
        artist_mbid: "mbid-1",
        artist_name: "Test Artist",
        last_checked_at: "2025-01-01T00:00:00.000Z",
      },
    ]);
    mockAggregate.mockResolvedValue([makeAggregated()]);
    mockFindRelease.mockResolvedValue(null);

    await runPollOnce();

    expect(mockRecord).toHaveBeenCalledWith({
      followed_artist_id: 1,
      release_key: "key-1",
      album_title: "New Album",
      release_date: "2025-04-01",
      release_group_mbid: "rg-1",
      cover_url: "https://caa/rg-1",
      release_type: "Album",
      secondary_types: [],
    });
    expect(mockUpdateChecked).toHaveBeenCalledTimes(1);
  });

  it("skips releases already recorded with an MBID", async () => {
    mockGetAll.mockResolvedValue([
      {
        id: 1,
        user_id: 10,
        artist_mbid: "mbid-1",
        artist_name: "X",
        last_checked_at: "2025-01-01",
      },
    ]);
    mockAggregate.mockResolvedValue([makeAggregated()]);
    mockFindRelease.mockResolvedValue({ id: 4, release_group_mbid: "rg-1" });

    await runPollOnce();

    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockBackfill).not.toHaveBeenCalled();
    expect(mockUpdateChecked).toHaveBeenCalledTimes(1);
  });

  it("backfills MB metadata onto a release first seen from Deezer", async () => {
    mockGetAll.mockResolvedValue([
      {
        id: 1,
        user_id: 10,
        artist_mbid: "mbid-1",
        artist_name: "X",
        last_checked_at: "2025-01-01",
      },
    ]);
    mockAggregate.mockResolvedValue([makeAggregated()]);
    mockFindRelease.mockResolvedValue({ id: 4, release_group_mbid: null });

    await runPollOnce();

    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockBackfill).toHaveBeenCalledWith(4, {
      release_group_mbid: "rg-1",
      cover_url: "https://caa/rg-1",
      release_type: "Album",
      secondary_types: [],
    });
  });

  it("does not backfill when the aggregated release has no MBID either", async () => {
    mockGetAll.mockResolvedValue([
      {
        id: 1,
        user_id: 10,
        artist_mbid: "mbid-1",
        artist_name: "X",
        last_checked_at: "2025-01-01",
      },
    ]);
    mockAggregate.mockResolvedValue([
      makeAggregated({ source: "deezer", release_group_mbid: null }),
    ]);
    mockFindRelease.mockResolvedValue({ id: 4, release_group_mbid: null });

    await runPollOnce();

    expect(mockBackfill).not.toHaveBeenCalled();
  });

  it("records every new release on first run regardless of date", async () => {
    mockGetAll.mockResolvedValue([
      {
        id: 1,
        user_id: 10,
        artist_mbid: "mbid-1",
        artist_name: "Test Artist",
        last_checked_at: null,
      },
    ]);
    mockAggregate.mockResolvedValue([
      makeAggregated({ release_key: "key-old", release_date: "2010-01-01" }),
      makeAggregated({
        release_key: "key-new",
        source: "deezer",
        release_group_mbid: null,
      }),
    ]);
    mockFindRelease.mockResolvedValue(null);

    await runPollOnce();

    expect(mockRecord).toHaveBeenCalledTimes(2);
    expect(mockUpdateChecked).toHaveBeenCalledTimes(1);
  });

  it("continues other artists when one fails", async () => {
    mockGetAll.mockResolvedValue([
      {
        id: 1,
        user_id: 1,
        artist_mbid: "a",
        artist_name: "A",
        last_checked_at: null,
      },
      {
        id: 2,
        user_id: 2,
        artist_mbid: "b",
        artist_name: "B",
        last_checked_at: "2025-01-01",
      },
    ]);
    mockAggregate
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([makeAggregated({ release_key: "k" })]);
    mockFindRelease.mockResolvedValue(null);

    await runPollOnce();

    expect(mockUpdateChecked).toHaveBeenCalledTimes(1);
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });
});

describe("new-release notifications", () => {
  const FOLLOW = {
    id: 1,
    user_id: 10,
    artist_mbid: "mbid-1",
    artist_name: "Test Artist",
    last_checked_at: "2025-01-01T00:00:00.000Z",
  };

  function daysAgo(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }

  beforeEach(() => {
    mockFindRelease.mockResolvedValue(null);
    mockRecord.mockResolvedValue(undefined);
    mockUpdateChecked.mockResolvedValue(undefined);
  });

  it("announces a release that just came out", async () => {
    mockGetAll.mockResolvedValue([FOLLOW]);
    mockAggregate.mockResolvedValue([
      makeAggregated({ release_date: daysAgo(3) }),
    ]);

    await runPollOnce();

    expect(mockNotifyRelease).toHaveBeenCalledWith({
      userId: 10,
      artistName: "Test Artist",
      artistMbid: "mbid-1",
      albumTitle: "New Album",
      releaseGroupMbid: "rg-1",
    });
  });

  it("stays silent on the first poll, which records the whole back catalogue", async () => {
    mockGetAll.mockResolvedValue([{ ...FOLLOW, last_checked_at: null }]);
    mockAggregate.mockResolvedValue([
      makeAggregated({ release_date: daysAgo(3) }),
      makeAggregated({ release_key: "key-2", release_date: daysAgo(4000) }),
    ]);

    await runPollOnce();

    expect(mockRecord).toHaveBeenCalledTimes(2);
    expect(mockNotifyRelease).not.toHaveBeenCalled();
  });

  it("ignores an old release that upstream only just catalogued", async () => {
    mockGetAll.mockResolvedValue([FOLLOW]);
    mockAggregate.mockResolvedValue([
      makeAggregated({ release_date: daysAgo(400) }),
    ]);

    await runPollOnce();

    expect(mockRecord).toHaveBeenCalled();
    expect(mockNotifyRelease).not.toHaveBeenCalled();
  });

  it("ignores an announced release that is not out yet", async () => {
    mockGetAll.mockResolvedValue([FOLLOW]);
    mockAggregate.mockResolvedValue([
      makeAggregated({ release_date: daysAgo(-30) }),
    ]);

    await runPollOnce();

    expect(mockNotifyRelease).not.toHaveBeenCalled();
  });

  it("ignores a release with no usable date", async () => {
    mockGetAll.mockResolvedValue([FOLLOW]);
    mockAggregate.mockResolvedValue([
      makeAggregated({ release_date: null }),
      makeAggregated({ release_key: "key-2", release_date: "not a date" }),
    ]);

    await runPollOnce();

    expect(mockNotifyRelease).not.toHaveBeenCalled();
  });

  it("does not re-announce a release it already knows about", async () => {
    mockGetAll.mockResolvedValue([FOLLOW]);
    mockAggregate.mockResolvedValue([
      makeAggregated({ release_date: daysAgo(3) }),
    ]);
    mockFindRelease.mockResolvedValue({ id: 99, release_group_mbid: "rg-1" });

    await runPollOnce();

    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockNotifyRelease).not.toHaveBeenCalled();
  });
});
