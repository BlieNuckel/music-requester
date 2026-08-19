import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAllTrackPlayCounts } from "./trackPlayCounts";

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

function rawTrack(index: number, viewCount: number, duration?: number) {
  return {
    ratingKey: String(index),
    title: `Track ${index}`,
    viewCount,
    duration,
    parentRatingKey: "alb1",
    parentTitle: "Album",
    grandparentRatingKey: "art1",
    grandparentTitle: "Andromedik",
  };
}

function tracksPage(start: number, count: number, totalSize: number) {
  return okResponse({
    MediaContainer: {
      totalSize,
      Metadata: Array.from({ length: count }, (_, i) => rawTrack(start + i, 5)),
    },
  });
}

describe("getAllTrackPlayCounts", () => {
  it("maps track metadata onto its album and artist", async () => {
    mockFetch.mockResolvedValueOnce(musicSection).mockResolvedValueOnce(
      okResponse({
        MediaContainer: { totalSize: 1, Metadata: [rawTrack(1, 12)] },
      })
    );

    const result = await getAllTrackPlayCounts("tok");

    expect(result).toEqual([
      {
        ratingKey: "1",
        title: "Track 1",
        artistKey: "art1",
        artistName: "Andromedik",
        albumKey: "alb1",
        albumTitle: "Album",
        viewCount: 12,
        durationMs: 0,
      },
    ]);
  });

  it("carries the track duration through", async () => {
    mockFetch.mockResolvedValueOnce(musicSection).mockResolvedValueOnce(
      okResponse({
        MediaContainer: { totalSize: 1, Metadata: [rawTrack(1, 2, 5_448_000)] },
      })
    );

    const result = await getAllTrackPlayCounts("tok");

    expect(result[0].durationMs).toBe(5_448_000);
  });

  it("reports zero for a track Plex gives no duration for", async () => {
    mockFetch.mockResolvedValueOnce(musicSection).mockResolvedValueOnce(
      okResponse({
        MediaContainer: { totalSize: 1, Metadata: [rawTrack(1, 2)] },
      })
    );

    const result = await getAllTrackPlayCounts("tok");

    expect(result[0].durationMs).toBe(0);
  });

  it("requests tracks sorted by play count descending", async () => {
    mockFetch.mockResolvedValueOnce(musicSection).mockResolvedValueOnce(
      okResponse({
        MediaContainer: { totalSize: 1, Metadata: [rawTrack(1, 3)] },
      })
    );

    await getAllTrackPlayCounts("tok");

    expect(mockFetch.mock.calls[1][0]).toContain("type=10");
    expect(mockFetch.mock.calls[1][0]).toContain("sort=viewCount:desc");
  });

  it("drops unplayed tracks", async () => {
    mockFetch.mockResolvedValueOnce(musicSection).mockResolvedValueOnce(
      okResponse({
        MediaContainer: {
          totalSize: 2,
          Metadata: [rawTrack(1, 7), rawTrack(2, 0)],
        },
      })
    );

    const result = await getAllTrackPlayCounts("tok");

    expect(result.map((t) => t.ratingKey)).toEqual(["1"]);
  });

  it("stops at the first page containing an unplayed track", async () => {
    mockFetch
      .mockResolvedValueOnce(musicSection)
      .mockResolvedValueOnce(tracksPage(0, PAGE_SIZE, 5000))
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            totalSize: 5000,
            Metadata: [
              ...Array.from({ length: PAGE_SIZE - 1 }, (_, i) =>
                rawTrack(PAGE_SIZE + i, 2)
              ),
              rawTrack(9999, 0),
            ],
          },
        })
      );

    const result = await getAllTrackPlayCounts("tok");

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(PAGE_SIZE * 2 - 1);
  });

  it("keeps paginating when a played track is dropped for missing artist attribution", async () => {
    const unattributed = {
      ratingKey: "999",
      title: "Orphan",
      viewCount: 4,
    };
    mockFetch
      .mockResolvedValueOnce(musicSection)
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            totalSize: PAGE_SIZE + 1,
            Metadata: [
              ...Array.from({ length: PAGE_SIZE - 1 }, (_, i) =>
                rawTrack(i, 5)
              ),
              unattributed,
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            totalSize: PAGE_SIZE + 1,
            Metadata: [rawTrack(PAGE_SIZE, 5)],
          },
        })
      );

    const result = await getAllTrackPlayCounts("tok");

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(PAGE_SIZE);
  });

  it("paginates through every page until totalSize", async () => {
    mockFetch
      .mockResolvedValueOnce(musicSection)
      .mockResolvedValueOnce(tracksPage(0, PAGE_SIZE, PAGE_SIZE + 2))
      .mockResolvedValueOnce(tracksPage(PAGE_SIZE, 2, PAGE_SIZE + 2));

    const result = await getAllTrackPlayCounts("tok");

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(PAGE_SIZE + 2);
  });

  it("throws when Plex rejects the request", async () => {
    mockFetch
      .mockResolvedValueOnce(musicSection)
      .mockResolvedValueOnce({ ok: false, status: 401 });

    await expect(getAllTrackPlayCounts("tok")).rejects.toThrow(
      "Plex returned 401"
    );
  });

  it("walks every music section, not only the first", async () => {
    mockFetch
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            Directory: [
              { key: "3", type: "artist", title: "Music" },
              { key: "8", type: "artist", title: "Soundtracks" },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: { totalSize: 1, Metadata: [rawTrack(1, 12)] },
        })
      )
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: { totalSize: 1, Metadata: [rawTrack(2, 4)] },
        })
      );

    const result = await getAllTrackPlayCounts("tok");

    expect(result.map((t) => t.ratingKey)).toEqual(["1", "2"]);
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("/library/sections/8/all"),
      expect.anything()
    );
  });
});
