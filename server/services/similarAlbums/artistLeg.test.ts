import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetArtistTopAlbums = vi.fn();
const mockGetSimilarArtists = vi.fn();

vi.mock("../../api/lastfm/albums", () => ({
  getArtistTopAlbums: (...args: unknown[]) => mockGetArtistTopAlbums(...args),
}));

vi.mock("../../api/listenbrainz/similarArtists", () => ({
  getSimilarArtists: (...args: unknown[]) => mockGetSimilarArtists(...args),
}));

import { collectArtistCandidates, selectNeighbours } from "./artistLeg";
import type { SeedAlbum } from "./types";

const seed: SeedAlbum = {
  mbid: "seed-rg",
  title: "Souvlaki",
  artistName: "Slowdive",
  artistMbid: "slowdive-mbid",
};

function similarArtist(name: string, score: number, mbid = `${name}-mbid`) {
  return {
    artist_mbid: mbid,
    name,
    comment: "",
    type: null,
    gender: null,
    score,
    reference_mbid: "slowdive-mbid",
  };
}

function topAlbums(names: string[]) {
  return names.map((name) => ({
    name,
    mbid: `mbid-${name}`,
    artistName: "",
    artistMbid: "",
    imageUrl: "",
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetArtistTopAlbums.mockResolvedValue([]);
});

describe("selectNeighbours", () => {
  it("returns nothing when the seed artist has no mbid", async () => {
    expect(await selectNeighbours({ ...seed, artistMbid: "" })).toEqual([]);
    expect(mockGetSimilarArtists).not.toHaveBeenCalled();
  });

  it("normalizes unbounded scores against the strongest neighbour", async () => {
    mockGetSimilarArtists.mockResolvedValue([
      similarArtist("Ride", 400),
      similarArtist("Lush", 100),
    ]);

    const neighbours = await selectNeighbours(seed);
    expect(neighbours[0].weight).toBe(1);
    expect(neighbours[1].weight).toBeCloseTo(0.25);
  });

  it("drops placeholder artists", async () => {
    mockGetSimilarArtists.mockResolvedValue([
      similarArtist("Various Artists", 400),
      similarArtist("Ride", 100),
    ]);

    const neighbours = await selectNeighbours(seed);
    expect(neighbours.map((n) => n.name)).toEqual(["Ride"]);
  });

  it("caps the number of neighbours", async () => {
    mockGetSimilarArtists.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => similarArtist(`artist-${i}`, 30 - i))
    );

    expect(await selectNeighbours(seed)).toHaveLength(12);
  });
});

describe("collectArtistCandidates", () => {
  it("returns nothing when there are no similar artists", async () => {
    mockGetSimilarArtists.mockResolvedValue([]);

    expect(await collectArtistCandidates(seed)).toEqual([]);
    expect(mockGetArtistTopAlbums).not.toHaveBeenCalled();
  });

  it("scores a closer neighbour's album above a distant one's", async () => {
    mockGetSimilarArtists.mockResolvedValue([
      similarArtist("Ride", 400),
      similarArtist("Lush", 40),
    ]);
    mockGetArtistTopAlbums.mockImplementation((name: string) =>
      Promise.resolve(topAlbums([`${name}-best`]))
    );

    const candidates = await collectArtistCandidates(seed);
    const ride = candidates.find((c) => c.title === "Ride-best");
    const lush = candidates.find((c) => c.title === "Lush-best");

    expect(ride!.score).toBeGreaterThan(lush!.score);
    expect(ride!.artistMbid).toBe("Ride-mbid");
    expect(ride!.artistName).toBe("Ride");
  });

  it("scores a neighbour's best-known album above its next one", async () => {
    mockGetSimilarArtists.mockResolvedValue([similarArtist("Ride", 400)]);
    mockGetArtistTopAlbums.mockResolvedValue(
      topAlbums(["Nowhere", "Going Blank Again"])
    );

    const candidates = await collectArtistCandidates(seed);
    expect(candidates[0].score).toBeGreaterThan(candidates[1].score);
  });

  it("caps albums per neighbour", async () => {
    mockGetSimilarArtists.mockResolvedValue([similarArtist("Ride", 400)]);
    mockGetArtistTopAlbums.mockResolvedValue(
      topAlbums(["a", "b", "c", "d", "e"])
    );

    expect(await collectArtistCandidates(seed)).toHaveLength(3);
    expect(mockGetArtistTopAlbums).toHaveBeenCalledWith("Ride", "3");
  });

  it("keeps the other neighbours when one album lookup fails", async () => {
    mockGetSimilarArtists.mockResolvedValue([
      similarArtist("Ride", 400),
      similarArtist("Lush", 300),
    ]);
    mockGetArtistTopAlbums.mockImplementation((name: string) =>
      name === "Ride"
        ? Promise.reject(new Error("Last.fm down"))
        : Promise.resolve(topAlbums(["Spooky"]))
    );

    const candidates = await collectArtistCandidates(seed);
    expect(candidates.map((c) => c.title)).toEqual(["Spooky"]);
  });
});
