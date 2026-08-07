import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResilientFetch = vi.fn();

vi.mock("../resilientFetch", () => ({
  resilientFetch: (...args: unknown[]) => mockResilientFetch(...args),
}));

vi.mock("../../logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

import {
  getArtistAlbumsByName,
  getAlbumArtwork,
  getAlbumsArtwork,
} from "./albums";

function okResponse(body: unknown) {
  return { ok: true, json: async () => body, status: 200 };
}

function notFoundResponse() {
  return { ok: false, status: 404, json: async () => ({}) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getArtistAlbumsByName", () => {
  it("returns empty array when artist lookup fails", async () => {
    mockResilientFetch.mockResolvedValueOnce(okResponse({ data: [] }));

    const result = await getArtistAlbumsByName("Unknown Artist");
    expect(result).toEqual([]);
    expect(mockResilientFetch).toHaveBeenCalledTimes(1);
  });

  it("returns empty array on artist search HTTP error", async () => {
    mockResilientFetch.mockResolvedValueOnce(notFoundResponse());
    const result = await getArtistAlbumsByName("Some Artist");
    expect(result).toEqual([]);
  });

  it("fetches albums for resolved artist id", async () => {
    mockResilientFetch
      .mockResolvedValueOnce(
        okResponse({ data: [{ id: 42, name: "Radiohead" }] })
      )
      .mockResolvedValueOnce(
        okResponse({
          data: [
            { id: 1, title: "OK Computer", release_date: "1997-06-16" },
            { id: 2, title: "Kid A", release_date: "2000-10-02" },
          ],
        })
      );

    const result = await getArtistAlbumsByName("Radiohead");
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("OK Computer");
    const secondCallUrl = mockResilientFetch.mock.calls[1][0] as string;
    expect(secondCallUrl).toContain("/artist/42/albums");
  });

  it("returns empty array when album fetch fails", async () => {
    mockResilientFetch
      .mockResolvedValueOnce(okResponse({ data: [{ id: 42, name: "Foo" }] }))
      .mockResolvedValueOnce(notFoundResponse());

    const result = await getArtistAlbumsByName("Foo");
    expect(result).toEqual([]);
  });

  it("returns empty array if resilientFetch throws on artist search", async () => {
    mockResilientFetch.mockRejectedValueOnce(new Error("network"));
    const result = await getArtistAlbumsByName("Foo");
    expect(result).toEqual([]);
  });

  it("returns empty array if resilientFetch throws on album fetch", async () => {
    mockResilientFetch
      .mockResolvedValueOnce(okResponse({ data: [{ id: 1, name: "Bar" }] }))
      .mockRejectedValueOnce(new Error("network"));
    const result = await getArtistAlbumsByName("Bar");
    expect(result).toEqual([]);
  });

  it("respects limit query param", async () => {
    mockResilientFetch
      .mockResolvedValueOnce(okResponse({ data: [{ id: 7, name: "X" }] }))
      .mockResolvedValueOnce(okResponse({ data: [] }));

    await getArtistAlbumsByName("X", 5);
    const url = mockResilientFetch.mock.calls[1][0] as string;
    expect(url).toContain("limit=5");
  });
});

describe("getAlbumArtwork", () => {
  it("returns cover_xl for a matched album", async () => {
    mockResilientFetch.mockResolvedValueOnce(
      okResponse({
        data: [
          { id: 1, title: "OK Computer", cover_xl: "https://cdn/ok-xl.jpg" },
        ],
      })
    );

    const result = await getAlbumArtwork("OK Computer", "Radiohead");
    expect(result).toBe("https://cdn/ok-xl.jpg");
    const url = mockResilientFetch.mock.calls[0][0] as string;
    expect(url).toContain("/search/album");
    const query = decodeURIComponent(url).replace(/\+/g, " ");
    expect(query).toContain('artist:"Radiohead" album:"OK Computer"');
  });

  it("falls back to cover when cover_xl is absent", async () => {
    mockResilientFetch.mockResolvedValueOnce(
      okResponse({
        data: [{ id: 2, title: "Kid A", cover: "https://cdn/ka.jpg" }],
      })
    );

    const result = await getAlbumArtwork("Kid A", "Radiohead");
    expect(result).toBe("https://cdn/ka.jpg");
  });

  it("returns empty string when no album matches", async () => {
    mockResilientFetch.mockResolvedValueOnce(okResponse({ data: [] }));
    const result = await getAlbumArtwork("Nonexistent", "Nobody");
    expect(result).toBe("");
  });

  it("returns empty string on HTTP error", async () => {
    mockResilientFetch.mockResolvedValueOnce(notFoundResponse());
    const result = await getAlbumArtwork("Broken", "Artist");
    expect(result).toBe("");
  });

  it("returns empty string when resilientFetch throws", async () => {
    mockResilientFetch.mockRejectedValueOnce(new Error("network"));
    const result = await getAlbumArtwork("Thrower", "Artist");
    expect(result).toBe("");
  });
});

describe("getAlbumsArtwork", () => {
  it("builds a lowercase name|artist keyed map", async () => {
    mockResilientFetch
      .mockResolvedValueOnce(
        okResponse({
          data: [{ id: 1, title: "A", cover_xl: "https://cdn/a.jpg" }],
        })
      )
      .mockResolvedValueOnce(
        okResponse({
          data: [{ id: 2, title: "B", cover_xl: "https://cdn/b.jpg" }],
        })
      );

    const result = await getAlbumsArtwork([
      { name: "Album One", artistName: "Artist One" },
      { name: "Album Two", artistName: "Artist Two" },
    ]);

    expect(result.get("album one|artist one")).toBe("https://cdn/a.jpg");
    expect(result.get("album two|artist two")).toBe("https://cdn/b.jpg");
  });
});
