import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getOrAddArtist,
  getOrAddAlbum,
  getAlbumByMbid,
  removeAlbum,
  waitForArtistRefresh,
  waitForAlbumTracks,
} from "./helpers";
import { getArtistList, invalidateArtistList } from "./artists";
import type { LidarrArtist, LidarrAlbum } from "../../api/lidarr/types";

vi.mock("../../config", () => ({
  getConfigValue: vi.fn(() => 1),
}));

vi.mock("../../api/lidarr/get", () => ({
  lidarrGet: vi.fn(),
}));

vi.mock("../../api/lidarr/post", () => ({
  lidarrPost: vi.fn(),
}));

vi.mock("../../api/lidarr/put", () => ({
  lidarrPut: vi.fn(),
}));

vi.mock("../../api/asyncLock", async () => {
  const actual = await vi.importActual<typeof import("../../api/asyncLock")>(
    "../../api/asyncLock"
  );
  return { AsyncLock: actual.AsyncLock };
});

import { lidarrGet } from "../../api/lidarr/get";
import { lidarrPost } from "../../api/lidarr/post";
import { lidarrPut } from "../../api/lidarr/put";

const mockLidarrGet = vi.mocked(lidarrGet);
const mockLidarrPost = vi.mocked(lidarrPost);
const mockLidarrPut = vi.mocked(lidarrPut);

beforeEach(() => {
  vi.clearAllMocks();
  invalidateArtistList();
});

const mockArtist: LidarrArtist = {
  id: 1,
  artistName: "Radiohead",
  foreignArtistId: "artist-mbid-1",
  monitored: true,
  folder: "/music/Radiohead",
};

const mockAlbum: LidarrAlbum = {
  id: 10,
  title: "OK Computer",
  foreignAlbumId: "album-mbid-1",
  monitored: true,
  artist: { id: 1, artistName: "Radiohead", foreignArtistId: "artist-mbid-1" },
};

describe("getAlbumByMbid", () => {
  it("returns album from lookup", async () => {
    mockLidarrGet.mockResolvedValue({
      status: 200,
      data: [mockAlbum],
      ok: true,
    });

    const result = await getAlbumByMbid("album-mbid-1");
    expect(result).toEqual(mockAlbum);
    expect(mockLidarrGet).toHaveBeenCalledWith("/album/lookup", {
      term: "lidarr:album-mbid-1",
    });
  });

  it("throws when album not found", async () => {
    mockLidarrGet.mockResolvedValue({ status: 200, data: [], ok: true });

    await expect(getAlbumByMbid("bad-mbid")).rejects.toThrow("Album not found");
  });

  it("throws on non-200 status", async () => {
    mockLidarrGet.mockResolvedValue({ status: 404, data: [], ok: false });

    await expect(getAlbumByMbid("bad-mbid")).rejects.toThrow("Album not found");
  });
});

describe("getOrAddArtist", () => {
  it("returns existing artist without adding", async () => {
    mockLidarrGet.mockResolvedValue({
      status: 200,
      data: [mockArtist],
      ok: true,
    });

    const result = await getOrAddArtist("artist-mbid-1");
    expect(result).toEqual(mockArtist);
    expect(mockLidarrPost).not.toHaveBeenCalled();
  });

  it("adds artist when not found in library", async () => {
    mockLidarrGet
      .mockResolvedValueOnce({ status: 200, data: [], ok: true })
      .mockResolvedValueOnce({ status: 200, data: [mockArtist], ok: true })
      .mockResolvedValueOnce({ status: 200, data: [], ok: true });

    mockLidarrPost.mockResolvedValue({
      status: 201,
      data: mockArtist,
      ok: true,
    });

    const result = await getOrAddArtist("new-artist-mbid");
    expect(result).toEqual(mockArtist);
    expect(mockLidarrPost).toHaveBeenCalledWith(
      "/artist",
      expect.objectContaining({
        monitored: true,
        addOptions: { monitor: "existing", monitored: true },
      })
    );
    expect(mockLidarrGet).toHaveBeenCalledWith("/command");
  });

  it("throws when artist lookup fails", async () => {
    mockLidarrGet
      .mockResolvedValueOnce({ status: 200, data: [], ok: true })
      .mockResolvedValueOnce({ status: 200, data: [], ok: true });

    await expect(getOrAddArtist("unknown")).rejects.toThrow(
      "Artist not found in Lidarr lookup"
    );
  });
});

describe("waitForArtistRefresh", () => {
  it("completes immediately when no running commands", async () => {
    mockLidarrGet.mockResolvedValueOnce({ status: 200, data: [], ok: true });

    await waitForArtistRefresh();
    expect(mockLidarrGet).toHaveBeenCalledWith("/command");
    expect(mockLidarrGet).toHaveBeenCalledTimes(1);
  });

  it("waits then completes when command finishes", async () => {
    const runningCommand = {
      id: 1,
      name: "RefreshArtist",
      status: "started",
    };

    mockLidarrGet
      .mockResolvedValueOnce({
        status: 200,
        data: [runningCommand],
        ok: true,
      })
      .mockResolvedValueOnce({ status: 200, data: [], ok: true });

    await waitForArtistRefresh();
    expect(mockLidarrGet).toHaveBeenCalledTimes(2);
  });

  it("times out gracefully without throwing", async () => {
    vi.useFakeTimers();

    const runningCommand = {
      id: 1,
      name: "RefreshArtist",
      status: "started",
    };

    mockLidarrGet.mockResolvedValue({
      status: 200,
      data: [runningCommand],
      ok: true,
    });

    const promise = waitForArtistRefresh();
    // Advance past the 30s deadline
    for (let i = 0; i < 35; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    await promise;

    vi.useRealTimers();
  });

  it("ignores non-RefreshArtist commands", async () => {
    const otherCommand = { id: 1, name: "RescanFolders", status: "started" };

    mockLidarrGet.mockResolvedValueOnce({
      status: 200,
      data: [otherCommand],
      ok: true,
    });

    await waitForArtistRefresh();
    expect(mockLidarrGet).toHaveBeenCalledTimes(1);
  });

  it("ignores completed RefreshArtist commands", async () => {
    const completedCommand = {
      id: 1,
      name: "RefreshArtist",
      status: "completed",
    };

    mockLidarrGet.mockResolvedValueOnce({
      status: 200,
      data: [completedCommand],
      ok: true,
    });

    await waitForArtistRefresh();
    expect(mockLidarrGet).toHaveBeenCalledTimes(1);
  });
});

describe("waitForAlbumTracks", () => {
  it("returns as soon as the album reports tracks", async () => {
    mockLidarrGet.mockResolvedValue({
      status: 200,
      ok: true,
      data: { id: 10, statistics: { totalTrackCount: 12 } },
    });

    await expect(waitForAlbumTracks(10)).resolves.toBe(true);
    expect(mockLidarrGet).toHaveBeenCalledWith("/album/10");
    expect(mockLidarrGet).toHaveBeenCalledTimes(1);
  });

  it("accepts a release track count when statistics are empty", async () => {
    mockLidarrGet.mockResolvedValue({
      status: 200,
      ok: true,
      data: { id: 10, releases: [{ id: 1, trackCount: 9 }] },
    });

    await expect(waitForAlbumTracks(10)).resolves.toBe(true);
  });

  it("keeps polling while the album has no tracks yet", async () => {
    vi.useFakeTimers();

    mockLidarrGet
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        data: { id: 10, statistics: { totalTrackCount: 0 }, releases: [] },
      })
      .mockResolvedValue({
        status: 200,
        ok: true,
        data: { id: 10, statistics: { totalTrackCount: 11 } },
      });

    const pending = waitForAlbumTracks(10);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toBe(true);
    expect(mockLidarrGet).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});

describe("getOrAddAlbum", () => {
  it("returns existing album with wasAdded=false", async () => {
    mockLidarrGet.mockResolvedValue({
      status: 200,
      data: [mockAlbum],
      ok: true,
    });

    const result = await getOrAddAlbum("album-mbid-1", mockArtist);
    expect(result.wasAdded).toBe(false);
    expect(result.album).toEqual(mockAlbum);
    expect(mockLidarrPost).not.toHaveBeenCalled();
  });

  it("adds album when not found and returns wasAdded=true", async () => {
    mockLidarrGet
      .mockResolvedValueOnce({ status: 200, data: [], ok: true })
      .mockResolvedValueOnce({ status: 200, data: [mockAlbum], ok: true });

    mockLidarrPost.mockResolvedValue({
      status: 201,
      data: mockAlbum,
      ok: true,
    });

    const result = await getOrAddAlbum("new-album-mbid", mockArtist);
    expect(result.wasAdded).toBe(true);
    expect(result.album).toEqual(mockAlbum);
  });

  it("adds the album without searching by default", async () => {
    mockLidarrGet
      .mockResolvedValueOnce({ status: 200, data: [], ok: true })
      .mockResolvedValueOnce({ status: 200, data: [mockAlbum], ok: true });

    mockLidarrPost.mockResolvedValue({
      status: 201,
      data: mockAlbum,
      ok: true,
    });

    await getOrAddAlbum("new-album-mbid", mockArtist);

    expect(mockLidarrPost).toHaveBeenCalledWith(
      "/album",
      expect.objectContaining({
        addOptions: { searchForNewAlbum: false },
      })
    );
  });

  it("searches on add when the caller asks for it", async () => {
    mockLidarrGet
      .mockResolvedValueOnce({ status: 200, data: [], ok: true })
      .mockResolvedValueOnce({ status: 200, data: [mockAlbum], ok: true });

    mockLidarrPost.mockResolvedValue({
      status: 201,
      data: mockAlbum,
      ok: true,
    });

    await getOrAddAlbum("new-album-mbid", mockArtist, { search: true });

    expect(mockLidarrPost).toHaveBeenCalledWith(
      "/album",
      expect.objectContaining({
        addOptions: { searchForNewAlbum: true },
      })
    );
  });

  it("throws when album add fails", async () => {
    mockLidarrGet
      .mockResolvedValueOnce({ status: 200, data: [], ok: true })
      .mockResolvedValueOnce({ status: 200, data: [mockAlbum], ok: true });

    mockLidarrPost.mockResolvedValue({
      status: 400,
      data: [{ errorMessage: "Album already exists" }],
      ok: false,
    });

    await expect(getOrAddAlbum("dup-mbid", mockArtist)).rejects.toThrow(
      "Failed to add album: Album already exists"
    );
  });
});

describe("removeAlbum", () => {
  it("returns artistInLibrary=false when artist is not in Lidarr", async () => {
    mockLidarrGet.mockResolvedValue({ status: 200, data: [], ok: true });

    const result = await removeAlbum("album-mbid-1", "artist-mbid-1");
    expect(result).toEqual({ artistInLibrary: false });
    expect(mockLidarrPut).not.toHaveBeenCalled();
  });

  it("returns albumInLibrary=false when album is not in Lidarr", async () => {
    mockLidarrGet
      .mockResolvedValueOnce({ status: 200, data: [mockArtist], ok: true })
      .mockResolvedValueOnce({ status: 200, data: [], ok: true });

    const result = await removeAlbum("album-mbid-1", "artist-mbid-1");
    expect(result).toEqual({ artistInLibrary: true, albumInLibrary: false });
    expect(mockLidarrPut).not.toHaveBeenCalled();
  });

  it("returns alreadyUnmonitored=true when album is already unmonitored", async () => {
    const unmonitoredAlbum = { ...mockAlbum, monitored: false };
    mockLidarrGet
      .mockResolvedValueOnce({ status: 200, data: [mockArtist], ok: true })
      .mockResolvedValueOnce({
        status: 200,
        data: [unmonitoredAlbum],
        ok: true,
      });

    const result = await removeAlbum("album-mbid-1", "artist-mbid-1");
    expect(result).toEqual({
      artistInLibrary: true,
      albumInLibrary: true,
      alreadyUnmonitored: true,
    });
    expect(mockLidarrPut).not.toHaveBeenCalled();
  });

  it("unmonitors album and returns alreadyUnmonitored=false on success", async () => {
    mockLidarrGet
      .mockResolvedValueOnce({ status: 200, data: [mockArtist], ok: true })
      .mockResolvedValueOnce({ status: 200, data: [mockAlbum], ok: true });
    mockLidarrPut.mockResolvedValue({ ok: true, status: 200, data: null });

    const result = await removeAlbum("album-mbid-1", "artist-mbid-1");
    expect(result).toEqual({
      artistInLibrary: true,
      albumInLibrary: true,
      alreadyUnmonitored: false,
    });
    expect(mockLidarrPut).toHaveBeenCalledWith("/album/monitor", {
      albumIds: [10],
      monitored: false,
    });
  });

  it("throws when unmonitor PUT fails", async () => {
    mockLidarrGet
      .mockResolvedValueOnce({ status: 200, data: [mockArtist], ok: true })
      .mockResolvedValueOnce({ status: 200, data: [mockAlbum], ok: true });
    mockLidarrPut.mockResolvedValue({ ok: false, status: 500, data: null });

    await expect(removeAlbum("album-mbid-1", "artist-mbid-1")).rejects.toThrow(
      "Failed to unmonitor album"
    );
  });
});

describe("library cache invalidation", () => {
  function countArtistFetches(): number {
    return mockLidarrGet.mock.calls.filter(([path]) => path === "/artist")
      .length;
  }

  it("drops the cached artist list once an album is unmonitored", async () => {
    mockLidarrGet.mockImplementation((path: string) =>
      Promise.resolve({
        status: 200,
        ok: true,
        data: path === "/album" ? [mockAlbum] : [mockArtist],
      })
    );
    mockLidarrPut.mockResolvedValue({ ok: true, status: 200, data: null });

    await getArtistList();
    await getArtistList();
    expect(countArtistFetches()).toBe(1);

    await removeAlbum("album-mbid-1", "artist-mbid-1");
    await getArtistList();

    expect(countArtistFetches()).toBe(3);
  });

  it("drops the cached artist list once an artist is added", async () => {
    mockLidarrGet.mockImplementation((path: string) =>
      Promise.resolve({
        status: 200,
        ok: true,
        data: path === "/artist" ? [] : [mockArtist],
      })
    );
    mockLidarrPost.mockResolvedValue({
      status: 201,
      data: mockArtist,
      ok: true,
    });

    await getArtistList();
    await getOrAddArtist("artist-mbid-1");
    const beforeReload = countArtistFetches();
    await getArtistList();

    expect(countArtistFetches()).toBe(beforeReload + 1);
  });
});

describe("getOrAddArtist concurrency", () => {
  it("serializes concurrent calls for the same artist to prevent duplicates", async () => {
    let callCount = 0;

    // First call: artist not found, triggers add
    // Second call: artist now exists (was added by first call)
    mockLidarrGet.mockImplementation(async (path: string) => {
      if (path === "/artist") {
        callCount++;
        if (callCount === 1) {
          await new Promise((r) => setTimeout(r, 20));
          return { status: 200, data: [], ok: true };
        }
        return { status: 200, data: [mockArtist], ok: true };
      }
      if (path === "/command") {
        return { status: 200, data: [], ok: true };
      }
      // lookup
      return { status: 200, data: [mockArtist], ok: true };
    });

    mockLidarrPost.mockResolvedValue({
      status: 201,
      data: mockArtist,
      ok: true,
    });

    const [r1, r2] = await Promise.all([
      getOrAddArtist("artist-mbid-1"),
      getOrAddArtist("artist-mbid-1"),
    ]);

    expect(r1).toEqual(mockArtist);
    expect(r2).toEqual(mockArtist);
    // Only one POST should have been made — the second call should find the existing artist
    expect(mockLidarrPost).toHaveBeenCalledTimes(1);
  });
});
