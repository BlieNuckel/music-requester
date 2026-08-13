import { describe, it, expect, vi, beforeEach } from "vitest";
import { getRatedItems, getItemRating } from "./ratings";

vi.mock("./config", () => ({
  getPlexConfig: vi.fn(() => ({
    baseUrl: "http://plex:32400",
    headers: { "X-Plex-Token": "tok", Accept: "application/json" },
    token: "tok",
  })),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

function okResponse(data: unknown) {
  return { ok: true, json: () => Promise.resolve(data) };
}

const musicSection = okResponse({
  MediaContainer: {
    Directory: [
      { key: "1", type: "movie", title: "Movies" },
      { key: "2", type: "artist", title: "Music" },
    ],
  },
});

describe("getRatedItems", () => {
  it("maps rated albums and tracks across both types", async () => {
    mockFetch
      .mockResolvedValueOnce(musicSection)
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            totalSize: 1,
            Metadata: [
              {
                ratingKey: "10",
                title: "In Rainbows",
                userRating: 10,
                parentTitle: "Radiohead",
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            totalSize: 1,
            Metadata: [
              {
                ratingKey: "55",
                title: "Nude",
                userRating: 8,
                grandparentTitle: "Radiohead",
                parentTitle: "In Rainbows",
              },
            ],
          },
        })
      );

    const result = await getRatedItems("tok");

    expect(result).toEqual([
      {
        ratingKey: "10",
        kind: "album",
        title: "In Rainbows",
        artist: "Radiohead",
        rating: 10,
      },
      {
        ratingKey: "55",
        kind: "track",
        title: "Nude",
        artist: "Radiohead",
        rating: 8,
      },
    ]);
  });

  it("applies the server-side userRating filter and the music section", async () => {
    mockFetch
      .mockResolvedValueOnce(musicSection)
      .mockResolvedValueOnce(okResponse({ MediaContainer: { Metadata: [] } }))
      .mockResolvedValueOnce(okResponse({ MediaContainer: { Metadata: [] } }));

    await getRatedItems("tok");

    const albumUrl = mockFetch.mock.calls[1][0] as string;
    expect(albumUrl).toContain("/library/sections/2/all");
    expect(albumUrl).toContain("type=9");
    expect(albumUrl).toContain("userRating%3E=1");

    const trackUrl = mockFetch.mock.calls[2][0] as string;
    expect(trackUrl).toContain("type=10");
  });

  it("paginates until totalSize is reached", async () => {
    const page = (start: number) =>
      okResponse({
        MediaContainer: {
          totalSize: 150,
          Metadata: Array.from({ length: 100 }, (_, i) => ({
            ratingKey: `${start + i}`,
            title: `t${start + i}`,
            userRating: 6,
            grandparentTitle: "X",
            parentTitle: "Y",
          })),
        },
      });

    mockFetch
      .mockResolvedValueOnce(musicSection)
      .mockResolvedValueOnce(page(0))
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            totalSize: 150,
            Metadata: Array.from({ length: 50 }, (_, i) => ({
              ratingKey: `${100 + i}`,
              title: `t${100 + i}`,
              userRating: 6,
              grandparentTitle: "X",
              parentTitle: "Y",
            })),
          },
        })
      );

    const result = await getRatedItems("tok", [10]);

    expect(result).toHaveLength(150);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("drops items with no userRating field", async () => {
    mockFetch.mockResolvedValueOnce(musicSection).mockResolvedValueOnce(
      okResponse({
        MediaContainer: {
          totalSize: 2,
          Metadata: [
            { ratingKey: "1", title: "Rated", userRating: 4, parentTitle: "A" },
            { ratingKey: "2", title: "Unrated", parentTitle: "A" },
          ],
        },
      })
    );

    const result = await getRatedItems("tok", [9]);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Rated");
  });

  it("throws on a Plex API error", async () => {
    mockFetch
      .mockResolvedValueOnce(musicSection)
      .mockResolvedValueOnce({ ok: false, status: 401 });

    await expect(getRatedItems("tok", [9])).rejects.toThrow(
      "Plex returned 401"
    );
  });

  it("reads ratings from every music section", async () => {
    const ratedIn = (sectionTitle: string) =>
      okResponse({
        MediaContainer: {
          totalSize: 1,
          Metadata: [
            {
              ratingKey: sectionTitle,
              title: sectionTitle,
              userRating: 8,
              parentTitle: "A",
            },
          ],
        },
      });

    mockFetch
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            Directory: [
              { key: "2", type: "artist", title: "Music" },
              { key: "6", type: "artist", title: "Classical" },
            ],
          },
        })
      )
      .mockResolvedValueOnce(ratedIn("music"))
      .mockResolvedValueOnce(ratedIn("classical"));

    const result = await getRatedItems("tok", [9]);

    expect(result.map((r) => r.title)).toEqual(["music", "classical"]);
  });
});

describe("getItemRating", () => {
  it("returns the rating when present", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ MediaContainer: { Metadata: [{ userRating: 6 }] } })
    );

    expect(await getItemRating("tok", "451")).toBe(6);
    expect(mockFetch.mock.calls[0][0]).toContain("/library/metadata/451");
  });

  it("returns null when the item has no userRating", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ MediaContainer: { Metadata: [{ title: "Unrated" }] } })
    );

    expect(await getItemRating("tok", "451")).toBeNull();
  });

  it("returns null when the item is missing", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ MediaContainer: { Metadata: [] } })
    );

    expect(await getItemRating("tok", "451")).toBeNull();
  });

  it("throws on a Plex API error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    await expect(getItemRating("tok", "451")).rejects.toThrow(
      "Plex returned 404"
    );
  });
});
