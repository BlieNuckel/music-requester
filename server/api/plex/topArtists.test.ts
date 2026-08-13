import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTopArtists } from "./topArtists";

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

describe("getTopArtists", () => {
  it("finds music section and returns filtered artists", async () => {
    mockFetch
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            Directory: [
              { key: "1", type: "movie", title: "Movies" },
              { key: "2", type: "artist", title: "Music" },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            Metadata: [
              {
                title: "Radiohead",
                viewCount: 150,
                thumb: "/library/metadata/123/thumb",
                Genre: [{ tag: "rock" }, { tag: "alternative" }],
              },
              {
                title: "Silence",
                viewCount: 0,
                thumb: "",
                Genre: [],
              },
              {
                title: "Portishead",
                viewCount: 42,
                thumb: "",
                Genre: [{ tag: "trip-hop" }],
              },
            ],
          },
        })
      );

    const result = await getTopArtists("tok", 10);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Radiohead");
    expect(result[0].viewCount).toBe(150);
    expect(result[0].thumb).toBe(
      "/api/plex/thumb?path=%2Flibrary%2Fmetadata%2F123%2Fthumb"
    );
    expect(result[0].genres).toEqual(["rock", "alternative"]);
    expect(result[1].name).toBe("Portishead");
    expect(result[1].thumb).toBe("");
  });

  it("throws when no music section exists", async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        MediaContainer: {
          Directory: [{ key: "1", type: "movie", title: "Movies" }],
        },
      })
    );

    await expect(getTopArtists("tok", 10)).rejects.toThrow(
      "No music library found in Plex"
    );
  });

  it("throws on sections API error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });

    await expect(getTopArtists("tok", 10)).rejects.toThrow("Plex returned 401");
  });

  it("aggregates recent plays by artist for a time range", async () => {
    mockFetch
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            Directory: [{ key: "2", type: "artist", title: "Music" }],
          },
        })
      )
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            Metadata: [
              {
                grandparentTitle: "Boards of Canada",
                grandparentThumb: "/library/metadata/9/thumb",
                viewedAt: 1700000000,
              },
              {
                grandparentTitle: "Aphex Twin",
                grandparentThumb: "/library/metadata/8/thumb",
                viewedAt: 1700000100,
              },
              {
                grandparentTitle: "Boards of Canada",
                viewedAt: 1700000200,
              },
              { viewedAt: 1700000300 },
            ],
          },
        })
      );

    const result = await getTopArtists("tok", 10, "4weeks");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: "Boards of Canada",
      viewCount: 2,
      thumb: "/api/plex/thumb?path=%2Flibrary%2Fmetadata%2F9%2Fthumb",
      genres: [],
    });
    expect(result[1].name).toBe("Aphex Twin");
  });

  it("queries the history endpoint with a viewedAt filter for ranges", async () => {
    mockFetch
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            Directory: [{ key: "2", type: "artist", title: "Music" }],
          },
        })
      )
      .mockResolvedValueOnce(okResponse({ MediaContainer: { Metadata: [] } }));

    await getTopArtists("tok", 10, "6months");

    const historyUrl = mockFetch.mock.calls[1][0] as string;
    expect(historyUrl).toContain("/status/sessions/history/all");
    expect(historyUrl).toContain("librarySectionID=2");
    expect(historyUrl).toContain("viewedAt%3E=");
  });

  it("limits and sorts history results by play count", async () => {
    const entries = [
      { grandparentTitle: "A", viewedAt: 1 },
      { grandparentTitle: "B", viewedAt: 2 },
      { grandparentTitle: "B", viewedAt: 3 },
      { grandparentTitle: "C", viewedAt: 4 },
      { grandparentTitle: "C", viewedAt: 5 },
      { grandparentTitle: "C", viewedAt: 6 },
    ];
    mockFetch
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            Directory: [{ key: "2", type: "artist", title: "Music" }],
          },
        })
      )
      .mockResolvedValueOnce(
        okResponse({ MediaContainer: { Metadata: entries } })
      );

    const result = await getTopArtists("tok", 2, "12months");

    expect(result.map((a) => a.name)).toEqual(["C", "B"]);
    expect(result[0].viewCount).toBe(3);
  });

  it("sums an artist's plays across every music section", async () => {
    mockFetch
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            Directory: [
              { key: "2", type: "artist", title: "Music" },
              { key: "6", type: "artist", title: "Soundtracks" },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            Metadata: [
              {
                title: "Hans Zimmer",
                viewCount: 40,
                Genre: [{ tag: "score" }],
              },
              { title: "Radiohead", viewCount: 30, Genre: [] },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        okResponse({
          MediaContainer: {
            Metadata: [
              {
                title: "Hans Zimmer",
                viewCount: 25,
                thumb: "/library/metadata/9/thumb",
                Genre: [{ tag: "soundtrack" }],
              },
            ],
          },
        })
      );

    const result = await getTopArtists("tok", 5);

    expect(result.map((a) => [a.name, a.viewCount])).toEqual([
      ["Hans Zimmer", 65],
      ["Radiohead", 30],
    ]);
    expect(result[0].genres).toEqual(["score", "soundtrack"]);
    expect(result[0].thumb).toContain("%2Flibrary%2Fmetadata%2F9%2Fthumb");
  });
});
