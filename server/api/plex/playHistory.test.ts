import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPlayHistory } from "./playHistory";

vi.mock("./config", () => ({
  getPlexConfig: vi.fn(() => ({
    baseUrl: "http://plex:32400",
    headers: { "X-Plex-Token": "tok", Accept: "application/json" },
    token: "tok",
  })),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const PAGE_SIZE = 1000;

beforeEach(() => {
  vi.clearAllMocks();
});

function okResponse(data: unknown) {
  return { ok: true, json: () => Promise.resolve(data) };
}

const musicSection = okResponse({
  MediaContainer: { Directory: [{ key: "3", type: "artist", title: "Music" }] },
});

function rawRow(index: number, viewedAt: number) {
  return {
    historyKey: `/status/sessions/history/${index}`,
    ratingKey: String(index),
    librarySectionID: 3,
    title: `Track ${index}`,
    parentKey: "/library/metadata/alb1",
    parentTitle: "Prologue",
    grandparentKey: "/library/metadata/art1",
    grandparentTitle: "Andromedik",
    index,
    viewedAt,
    accountID: 1,
    deviceID: 77,
  };
}

function historyPage(start: number, count: number, totalSize: number) {
  return okResponse({
    MediaContainer: {
      totalSize,
      Metadata: Array.from({ length: count }, (_, i) =>
        rawRow(start + i, 1_770_000_000 + start + i)
      ),
    },
  });
}

describe("getPlayHistory", () => {
  it("maps a history row onto its album and artist", async () => {
    mockFetch.mockResolvedValueOnce(musicSection).mockResolvedValueOnce(
      okResponse({
        MediaContainer: { totalSize: 1, Metadata: [rawRow(1, 1_770_000_000)] },
      })
    );

    const result = await getPlayHistory("tok");

    expect(result).toEqual([
      {
        ratingKey: "1",
        title: "Track 1",
        artistKey: "art1",
        artistName: "Andromedik",
        albumKey: "alb1",
        albumTitle: "Prologue",
        viewedAt: 1_770_000_000,
        accountID: 1,
        deviceID: 77,
      },
    ]);
  });

  it("prefers the plain rating keys when Plex sends them", async () => {
    mockFetch.mockResolvedValueOnce(musicSection).mockResolvedValueOnce(
      okResponse({
        MediaContainer: {
          totalSize: 1,
          Metadata: [
            {
              ...rawRow(1, 1_770_000_000),
              parentRatingKey: "99",
              grandparentRatingKey: "88",
            },
          ],
        },
      })
    );

    const [entry] = await getPlayHistory("tok");

    expect(entry.artistKey).toBe("88");
    expect(entry.albumKey).toBe("99");
  });

  it("requests only plays at or after the watermark, oldest first", async () => {
    mockFetch.mockResolvedValueOnce(musicSection).mockResolvedValueOnce(
      okResponse({
        MediaContainer: { totalSize: 0, Metadata: [] },
      })
    );

    await getPlayHistory("tok", 1_769_000_000);

    const url = mockFetch.mock.calls[1][0] as string;
    expect(url).toContain("librarySectionID=3");
    expect(url).toContain("viewedAt%3E=1769000000");
    expect(url).toContain("sort=viewedAt:asc");
  });

  it("pages to completion", async () => {
    mockFetch
      .mockResolvedValueOnce(musicSection)
      .mockResolvedValueOnce(historyPage(0, PAGE_SIZE, PAGE_SIZE + 3))
      .mockResolvedValueOnce(historyPage(PAGE_SIZE, 3, PAGE_SIZE + 3));

    const result = await getPlayHistory("tok");

    expect(result).toHaveLength(PAGE_SIZE + 3);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("drops rows with no track key or no artist attribution", async () => {
    mockFetch.mockResolvedValueOnce(musicSection).mockResolvedValueOnce(
      okResponse({
        MediaContainer: {
          totalSize: 3,
          Metadata: [
            rawRow(1, 1_770_000_000),
            { ...rawRow(2, 1_770_000_100), ratingKey: undefined },
            {
              ...rawRow(3, 1_770_000_200),
              grandparentTitle: undefined,
              grandparentKey: undefined,
            },
          ],
        },
      })
    );

    const result = await getPlayHistory("tok");

    expect(result.map((entry) => entry.ratingKey)).toEqual(["1"]);
  });

  it("returns one stream ordered by viewedAt across sections", async () => {
    mockFetch
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            Directory: [
              { key: "3", type: "artist", title: "Music" },
              { key: "4", type: "artist", title: "Sets" },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            totalSize: 1,
            Metadata: [rawRow(1, 1_770_000_200)],
          },
        })
      )
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            totalSize: 1,
            Metadata: [rawRow(2, 1_770_000_100)],
          },
        })
      );

    const result = await getPlayHistory("tok");

    expect(result.map((entry) => entry.viewedAt)).toEqual([
      1_770_000_100, 1_770_000_200,
    ]);
  });

  it("throws when Plex rejects the request", async () => {
    mockFetch
      .mockResolvedValueOnce(musicSection)
      .mockResolvedValueOnce({ ok: false, status: 401 });

    await expect(getPlayHistory("tok")).rejects.toThrow("Plex returned 401");
  });
});
