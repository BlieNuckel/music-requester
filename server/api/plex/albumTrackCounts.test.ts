import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAllAlbumTrackCounts } from "./albumTrackCounts";

vi.mock("./config", () => ({
  getPlexConfig: vi.fn(() => ({
    baseUrl: "http://plex:32400",
    headers: { "X-Plex-Token": "tok", Accept: "application/json" },
    token: "tok",
  })),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const PAGE_SIZE = 500;

beforeEach(() => {
  vi.clearAllMocks();
});

function okResponse(data: unknown) {
  return { ok: true, json: () => Promise.resolve(data) };
}

const musicSection = okResponse({
  MediaContainer: { Directory: [{ key: "3", type: "artist", title: "Music" }] },
});

function rawAlbum(index: number, leafCount: number) {
  return {
    ratingKey: String(index),
    title: `Album ${index}`,
    leafCount,
    parentRatingKey: "art1",
    parentTitle: "Andromedik",
  };
}

describe("getAllAlbumTrackCounts", () => {
  it("maps an album to its artist and track count", async () => {
    mockFetch.mockResolvedValueOnce(musicSection).mockResolvedValueOnce(
      okResponse({
        MediaContainer: { totalSize: 1, Metadata: [rawAlbum(1, 12)] },
      })
    );

    const result = await getAllAlbumTrackCounts("tok");

    expect(result).toEqual([
      {
        ratingKey: "1",
        title: "Album 1",
        artistKey: "art1",
        artistName: "Andromedik",
        trackCount: 12,
      },
    ]);
  });

  it("falls back to childCount when leafCount is absent", async () => {
    mockFetch.mockResolvedValueOnce(musicSection).mockResolvedValueOnce(
      okResponse({
        MediaContainer: {
          totalSize: 1,
          Metadata: [
            {
              ratingKey: "1",
              title: "Album 1",
              childCount: 7,
              parentRatingKey: "art1",
              parentTitle: "Andromedik",
            },
          ],
        },
      })
    );

    const result = await getAllAlbumTrackCounts("tok");

    expect(result[0].trackCount).toBe(7);
  });

  it("drops albums with no track count or no artist attribution", async () => {
    mockFetch.mockResolvedValueOnce(musicSection).mockResolvedValueOnce(
      okResponse({
        MediaContainer: {
          totalSize: 3,
          Metadata: [
            rawAlbum(1, 5),
            { ratingKey: "2", title: "Countless", parentTitle: "Andromedik" },
            { ratingKey: "3", title: "Orphan", leafCount: 4 },
          ],
        },
      })
    );

    const result = await getAllAlbumTrackCounts("tok");

    expect(result.map((a) => a.ratingKey)).toEqual(["1"]);
  });

  it("walks the whole listing rather than stopping at unplayed albums", async () => {
    const fullPage = Array.from({ length: PAGE_SIZE }, (_, i) =>
      rawAlbum(i, i === 0 ? 10 : 4)
    );
    mockFetch
      .mockResolvedValueOnce(musicSection)
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: { totalSize: PAGE_SIZE + 1, Metadata: fullPage },
        })
      )
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            totalSize: PAGE_SIZE + 1,
            Metadata: [rawAlbum(PAGE_SIZE, 6)],
          },
        })
      );

    const result = await getAllAlbumTrackCounts("tok");

    expect(result).toHaveLength(PAGE_SIZE + 1);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("requests albums, not tracks", async () => {
    mockFetch
      .mockResolvedValueOnce(musicSection)
      .mockResolvedValueOnce(
        okResponse({ MediaContainer: { totalSize: 0, Metadata: [] } })
      );

    await getAllAlbumTrackCounts("tok");

    const url = mockFetch.mock.calls[1][0] as string;
    expect(url).toContain("/library/sections/3/all");
    expect(url).toContain("type=9");
  });

  it("throws on a Plex API error", async () => {
    mockFetch
      .mockResolvedValueOnce(musicSection)
      .mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(getAllAlbumTrackCounts("tok")).rejects.toThrow(
      "Plex returned 500"
    );
  });
});
