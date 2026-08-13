import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getTopAlbumsByTag,
  getAlbumTopTags,
  getArtistTopAlbums,
} from "./albums";

vi.mock("./config", () => ({
  buildUrl: vi.fn(() => "https://lastfm.test/api"),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

function jsonResponse(data: unknown) {
  return { json: () => Promise.resolve(data) };
}

describe("getTopAlbumsByTag", () => {
  it("maps response to album objects with pagination", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        albums: {
          album: [
            {
              name: "OK Computer",
              mbid: "album-1",
              artist: { name: "Radiohead", mbid: "artist-1" },
            },
            {
              name: "Kid A",
              mbid: "album-2",
              artist: { name: "Radiohead", mbid: "artist-1" },
            },
          ],
          "@attr": { page: "1", totalPages: "3" },
        },
      })
    );

    const result = await getTopAlbumsByTag("alternative");
    expect(result.albums).toHaveLength(2);
    expect(result.albums[0]).toEqual({
      name: "OK Computer",
      mbid: "album-1",
      artistName: "Radiohead",
      artistMbid: "artist-1",
      imageUrl: "",
    });
    expect(result.pagination).toEqual({ page: 1, totalPages: 3 });
  });

  it("throws on API error response", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ error: 6, message: "Tag not found" })
    );

    await expect(getTopAlbumsByTag("nonexistent")).rejects.toThrow(
      "Tag not found"
    );
  });

  it("returns empty array when no albums", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ albums: {} }));

    const result = await getTopAlbumsByTag("niche");
    expect(result.albums).toEqual([]);
  });

  it("defaults pagination to page 1 of 1", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ albums: { album: [] } }));

    const result = await getTopAlbumsByTag("niche");
    expect(result.pagination).toEqual({ page: 1, totalPages: 1 });
  });

  it("throws with default message when API error has no message", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 6 }));

    await expect(getTopAlbumsByTag("bad")).rejects.toThrow("Last.fm API error");
  });

  it("handles missing mbid and artist fields", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        albums: {
          album: [{ name: "Album", mbid: "", artist: { name: "", mbid: "" } }],
        },
      })
    );

    const result = await getTopAlbumsByTag("rock");
    expect(result.albums[0]).toEqual({
      name: "Album",
      mbid: "",
      artistName: "",
      artistMbid: "",
      imageUrl: "",
    });
  });

  it("prefers the extralarge image", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        albums: {
          album: [
            {
              name: "Album",
              mbid: "album-1",
              artist: { name: "Artist", mbid: "artist-1" },
              image: [
                { "#text": "large.jpg", size: "large" },
                { "#text": "xl.jpg", size: "extralarge" },
              ],
            },
          ],
        },
      })
    );

    const result = await getTopAlbumsByTag("rock");
    expect(result.albums[0].imageUrl).toBe("xl.jpg");
  });
});

describe("getAlbumTopTags", () => {
  it("maps tags with numeric counts", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        toptags: {
          tag: [
            { name: "shoegaze", count: 100 },
            { name: "dream pop", count: "42" },
          ],
        },
      })
    );

    const result = await getAlbumTopTags("Slowdive", "Souvlaki");
    expect(result).toEqual([
      { name: "shoegaze", count: 100 },
      { name: "dream pop", count: 42 },
    ]);
  });

  it("returns empty array when the album has no tags", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ toptags: {} }));

    expect(await getAlbumTopTags("Artist", "Album")).toEqual([]);
  });

  it("throws on API error response", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ error: 6, message: "Album not found" })
    );

    await expect(getAlbumTopTags("Nobody", "Nothing")).rejects.toThrow(
      "Album not found"
    );
  });
});

describe("getArtistTopAlbums", () => {
  it("maps albums and falls back to the requested artist name", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        topalbums: {
          album: [
            {
              name: "Loveless",
              mbid: "album-1",
              artist: { name: "My Bloody Valentine", mbid: "artist-1" },
              image: [{ "#text": "xl.jpg", size: "extralarge" }],
            },
            { name: "Isn't Anything", mbid: "" },
          ],
        },
      })
    );

    const result = await getArtistTopAlbums("My Bloody Valentine");
    expect(result).toEqual([
      {
        name: "Loveless",
        mbid: "album-1",
        artistName: "My Bloody Valentine",
        artistMbid: "artist-1",
        imageUrl: "xl.jpg",
      },
      {
        name: "Isn't Anything",
        mbid: "",
        artistName: "My Bloody Valentine",
        artistMbid: "",
        imageUrl: "",
      },
    ]);
  });

  it("returns empty array when the artist has no albums", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ topalbums: {} }));

    expect(await getArtistTopAlbums("Obscure")).toEqual([]);
  });

  it("throws with default message when API error has no message", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 6 }));

    await expect(getArtistTopAlbums("bad")).rejects.toThrow(
      "Last.fm API error"
    );
  });
});
