import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLidarrGet = vi.fn();

vi.mock("../../api/lidarr/get", () => ({
  lidarrGet: (...args: unknown[]) => mockLidarrGet(...args),
}));

import { getArtistList, invalidateArtistList } from "./artists";

beforeEach(() => {
  vi.clearAllMocks();
  invalidateArtistList();
});

describe("getArtistList", () => {
  it("maps artist fields correctly", async () => {
    mockLidarrGet.mockResolvedValue({
      ok: true,
      status: 200,
      data: [
        {
          id: 1,
          artistName: "Radiohead",
          foreignArtistId: "mbid-1",
          monitored: true,
          folder: "/music/Radiohead",
        },
      ],
    });

    const result = await getArtistList();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([
        { id: 1, name: "Radiohead", foreignArtistId: "mbid-1" },
      ]);
    }
  });

  it("returns error when Lidarr API fails", async () => {
    mockLidarrGet.mockResolvedValue({
      ok: false,
      status: 503,
      data: null,
    });

    const result = await getArtistList();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
    }
  });
});

describe("getArtistList caching", () => {
  const okResponse = {
    ok: true,
    status: 200,
    data: [{ id: 1, artistName: "Radiohead", foreignArtistId: "mbid-1" }],
  };

  it("serves repeat calls from the cached snapshot", async () => {
    mockLidarrGet.mockResolvedValue(okResponse);

    await getArtistList();
    await getArtistList();

    expect(mockLidarrGet).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed fetch", async () => {
    mockLidarrGet
      .mockResolvedValueOnce({ ok: false, status: 503, data: null })
      .mockResolvedValue(okResponse);

    const first = await getArtistList();
    const second = await getArtistList();

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
  });

  it("refetches after invalidation", async () => {
    mockLidarrGet.mockResolvedValue(okResponse);

    await getArtistList();
    invalidateArtistList();
    await getArtistList();

    expect(mockLidarrGet).toHaveBeenCalledTimes(2);
  });
});
