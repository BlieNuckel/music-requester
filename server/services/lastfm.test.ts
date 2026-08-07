import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetArtistsImages = vi.fn();
const mockGetAlbumsArtwork = vi.fn();

vi.mock("../api/deezer/artists", () => ({
  getArtistsImages: (...args: unknown[]) => mockGetArtistsImages(...args),
}));

vi.mock("../api/deezer/albums", () => ({
  getAlbumsArtwork: (...args: unknown[]) => mockGetAlbumsArtwork(...args),
}));

import {
  enrichArtistsWithImages,
  enrichArtistSectionsWithImages,
  enrichAlbumsWithArtwork,
} from "./lastfm";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("enrichArtistsWithImages", () => {
  it("merges Deezer images into artists", async () => {
    const artists = [
      { name: "Radiohead", match: 0.9, imageUrl: "" },
      { name: "Thom Yorke", match: 0.8, imageUrl: "existing.jpg" },
    ];
    mockGetArtistsImages.mockResolvedValue(
      new Map([["radiohead", "https://deezer.com/radiohead.jpg"]])
    );

    const result = await enrichArtistsWithImages(artists);
    expect(result).toEqual([
      {
        name: "Radiohead",
        match: 0.9,
        imageUrl: "https://deezer.com/radiohead.jpg",
      },
      { name: "Thom Yorke", match: 0.8, imageUrl: "existing.jpg" },
    ]);
    expect(mockGetArtistsImages).toHaveBeenCalledWith([
      "Radiohead",
      "Thom Yorke",
    ]);
  });

  it("preserves existing imageUrl when no Deezer image found", async () => {
    const artists = [{ name: "Unknown", imageUrl: "fallback.jpg" }];
    mockGetArtistsImages.mockResolvedValue(new Map());

    const result = await enrichArtistsWithImages(artists);
    expect(result[0].imageUrl).toBe("fallback.jpg");
  });
});

describe("enrichArtistSectionsWithImages", () => {
  it("merges images across all sections", async () => {
    const sections = [
      {
        tagCount: 2,
        tagNames: ["rock", "grunge"],
        artists: [
          { name: "Nirvana", imageUrl: "" },
          { name: "Pearl Jam", imageUrl: "" },
        ],
      },
      {
        tagCount: 1,
        tagNames: ["rock"],
        artists: [{ name: "Radiohead", imageUrl: "" }],
      },
    ];
    mockGetArtistsImages.mockResolvedValue(
      new Map([
        ["nirvana", "https://deezer.com/nirvana.jpg"],
        ["radiohead", "https://deezer.com/radiohead.jpg"],
      ])
    );

    const result = await enrichArtistSectionsWithImages(sections);
    expect(result[0].artists[0].imageUrl).toBe(
      "https://deezer.com/nirvana.jpg"
    );
    expect(result[0].artists[1].imageUrl).toBe("");
    expect(result[1].artists[0].imageUrl).toBe(
      "https://deezer.com/radiohead.jpg"
    );
    expect(mockGetArtistsImages).toHaveBeenCalledWith([
      "Nirvana",
      "Pearl Jam",
      "Radiohead",
    ]);
  });
});

describe("enrichAlbumsWithArtwork", () => {
  it("merges Deezer artwork into albums", async () => {
    const albums = [
      { name: "OK Computer", artistName: "Radiohead", imageUrl: "" },
      { name: "Kid A", artistName: "Radiohead", imageUrl: "existing.jpg" },
    ];
    mockGetAlbumsArtwork.mockResolvedValue(
      new Map([["ok computer|radiohead", "https://deezer.com/okcomputer.jpg"]])
    );

    const result = await enrichAlbumsWithArtwork(albums);
    expect(result[0].imageUrl).toBe("https://deezer.com/okcomputer.jpg");
    expect(result[1].imageUrl).toBe("existing.jpg");
    expect(mockGetAlbumsArtwork).toHaveBeenCalledWith([
      { name: "OK Computer", artistName: "Radiohead" },
      { name: "Kid A", artistName: "Radiohead" },
    ]);
  });
});
