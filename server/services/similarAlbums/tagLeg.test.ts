import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAlbumTopTags = vi.fn();
const mockGetTopAlbumsByTag = vi.fn();

vi.mock("../../api/lastfm/albums", () => ({
  getAlbumTopTags: (...args: unknown[]) => mockGetAlbumTopTags(...args),
  getTopAlbumsByTag: (...args: unknown[]) => mockGetTopAlbumsByTag(...args),
}));

import { collectTagCandidates, selectSeedTags } from "./tagLeg";
import type { SeedAlbum } from "./types";

const seed: SeedAlbum = {
  mbid: "seed-rg",
  title: "Souvlaki",
  artistName: "Slowdive",
  artistMbid: "slowdive-mbid",
};

const genericTags = new Set(["seen live", "favorites"]);

function tagAlbums(names: string[]) {
  return {
    albums: names.map((name, i) => ({
      name,
      mbid: `mbid-${name}`,
      artistName: `artist-${i}`,
      artistMbid: `artist-mbid-${i}`,
      imageUrl: "",
    })),
    pagination: { page: 1, totalPages: 1 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTopAlbumsByTag.mockResolvedValue(tagAlbums([]));
});

describe("selectSeedTags", () => {
  it("drops generic tags and keeps the three strongest", async () => {
    mockGetAlbumTopTags.mockResolvedValue([
      { name: "seen live", count: 500 },
      { name: "shoegaze", count: 100 },
      { name: "dream pop", count: 80 },
      { name: "ambient", count: 60 },
      { name: "90s", count: 40 },
    ]);

    expect(await selectSeedTags(seed, genericTags)).toEqual([
      "shoegaze",
      "dream pop",
      "ambient",
    ]);
  });

  it("is case insensitive about generic tags", async () => {
    mockGetAlbumTopTags.mockResolvedValue([{ name: "Seen Live", count: 500 }]);

    expect(await selectSeedTags(seed, genericTags)).toEqual([]);
  });

  it("returns empty when the tag lookup fails", async () => {
    mockGetAlbumTopTags.mockRejectedValue(new Error("Last.fm down"));

    expect(await selectSeedTags(seed, genericTags)).toEqual([]);
  });
});

describe("collectTagCandidates", () => {
  it("returns nothing when the album has no usable tags", async () => {
    mockGetAlbumTopTags.mockResolvedValue([{ name: "seen live", count: 10 }]);

    expect(await collectTagCandidates(seed, genericTags)).toEqual([]);
    expect(mockGetTopAlbumsByTag).not.toHaveBeenCalled();
  });

  it("scores the seed's strongest tag above its weakest", async () => {
    mockGetAlbumTopTags.mockResolvedValue([
      { name: "shoegaze", count: 100 },
      { name: "dream pop", count: 80 },
    ]);
    mockGetTopAlbumsByTag.mockImplementation((tag: string) =>
      Promise.resolve(tagAlbums([`${tag}-top`]))
    );

    const candidates = await collectTagCandidates(seed, genericTags);
    const shoegaze = candidates.find((c) => c.title === "shoegaze-top");
    const dreamPop = candidates.find((c) => c.title === "dream pop-top");

    expect(shoegaze!.score).toBeGreaterThan(dreamPop!.score);
    expect(candidates.every((c) => c.reason === "tag")).toBe(true);
  });

  it("scores the top of a chart above its tail", async () => {
    mockGetAlbumTopTags.mockResolvedValue([{ name: "shoegaze", count: 100 }]);
    mockGetTopAlbumsByTag.mockResolvedValue(tagAlbums(["first", "second"]));

    const candidates = await collectTagCandidates(seed, genericTags);
    expect(candidates[0].score).toBeGreaterThan(candidates[1].score);
  });

  it("caps how far down a chart it reads", async () => {
    mockGetAlbumTopTags.mockResolvedValue([{ name: "shoegaze", count: 100 }]);
    mockGetTopAlbumsByTag.mockResolvedValue(
      tagAlbums(Array.from({ length: 60 }, (_, i) => `album-${i}`))
    );

    expect(await collectTagCandidates(seed, genericTags)).toHaveLength(25);
  });

  it("keeps the other tags when one chart lookup fails", async () => {
    mockGetAlbumTopTags.mockResolvedValue([
      { name: "shoegaze", count: 100 },
      { name: "dream pop", count: 80 },
    ]);
    mockGetTopAlbumsByTag.mockImplementation((tag: string) =>
      tag === "shoegaze"
        ? Promise.reject(new Error("Last.fm down"))
        : Promise.resolve(tagAlbums(["survivor"]))
    );

    const candidates = await collectTagCandidates(seed, genericTags);
    expect(candidates.map((c) => c.title)).toEqual(["survivor"]);
  });
});
