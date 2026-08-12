import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PromotedAlbumConfig } from "../config";
import type { SimilarGraphSeed } from "../db/entity/UserProfile";

const mockGetArtistMbidByName = vi.fn();
const mockGetSimilarArtists = vi.fn();
const mockGetArtistTopTags = vi.fn();
const mockFetchReleaseGroupsForArtist = vi.fn();

vi.mock("../api/musicbrainz/artists", () => ({
  getArtistMbidByName: (...args: unknown[]) => mockGetArtistMbidByName(...args),
}));

vi.mock("../api/listenbrainz/similarArtists", () => ({
  getSimilarArtists: (...args: unknown[]) => mockGetSimilarArtists(...args),
}));

vi.mock("../api/lastfm/artists", () => ({
  getArtistTopTags: (...args: unknown[]) => mockGetArtistTopTags(...args),
}));

vi.mock("../api/musicbrainz/releaseGroups", () => ({
  fetchReleaseGroupsForArtist: (...args: unknown[]) =>
    mockFetchReleaseGroupsForArtist(...args),
}));

import { buildSimilarGraph, buildExploreResult } from "./explore";
import { VARIOUS_ARTISTS_MBID } from "../utils/artistFilter";

const config = {
  genericTags: ["seen live"],
  exploreCandidateCount: 12,
  genreOverlapThreshold: 0.15,
} as unknown as PromotedAlbumConfig;

function similar(name: string, mbid: string, score: number) {
  return {
    artist_mbid: mbid,
    name,
    comment: "",
    type: "Group",
    gender: null,
    score,
    reference_mbid: "seed",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Math, "random").mockReturnValue(0.1);
});

describe("buildSimilarGraph", () => {
  it("builds a seed with genre-tagged candidates", async () => {
    mockGetArtistMbidByName.mockResolvedValue("mbid-seed");
    mockGetSimilarArtists.mockResolvedValue([
      similar("Jazz Cat", "mbid-jazz", 9000),
    ]);
    mockGetArtistTopTags.mockImplementation((name: string) =>
      Promise.resolve(
        name === "Radiohead"
          ? [{ name: "alternative", count: 100 }]
          : [{ name: "jazz", count: 100 }]
      )
    );

    const graph = await buildSimilarGraph(
      [{ name: "Radiohead", viewCount: 100 }],
      config
    );

    expect(graph).toEqual([
      {
        seedArtist: "Radiohead",
        seedMbid: "mbid-seed",
        seedGenres: ["alternative"],
        viewCount: 100,
        candidates: [
          {
            name: "Jazz Cat",
            artistMbid: "mbid-jazz",
            score: 9000,
            genres: ["jazz"],
          },
        ],
      },
    ]);
  });

  it("drops a seed with no MusicBrainz MBID", async () => {
    mockGetArtistMbidByName.mockResolvedValue(null);
    const graph = await buildSimilarGraph(
      [{ name: "Radiohead", viewCount: 100 }],
      config
    );
    expect(graph).toEqual([]);
    expect(mockGetSimilarArtists).not.toHaveBeenCalled();
  });

  it("drops a seed with no similar artists", async () => {
    mockGetArtistMbidByName.mockResolvedValue("mbid-seed");
    mockGetSimilarArtists.mockResolvedValue([]);
    const graph = await buildSimilarGraph(
      [{ name: "Radiohead", viewCount: 100 }],
      config
    );
    expect(graph).toEqual([]);
  });

  it("drops a seed whose tags are all generic", async () => {
    mockGetArtistMbidByName.mockResolvedValue("mbid-seed");
    mockGetSimilarArtists.mockResolvedValue([
      similar("Jazz Cat", "mbid-jazz", 9000),
    ]);
    mockGetArtistTopTags.mockResolvedValue([{ name: "seen live", count: 100 }]);
    const graph = await buildSimilarGraph(
      [{ name: "Radiohead", viewCount: 100 }],
      config
    );
    expect(graph).toEqual([]);
  });

  it("drops Various Artists from the candidate list", async () => {
    mockGetArtistMbidByName.mockResolvedValue("mbid-seed");
    mockGetSimilarArtists.mockResolvedValue([
      similar("Various Artists", VARIOUS_ARTISTS_MBID, 9999),
      similar("Jazz Cat", "mbid-jazz", 9000),
    ]);
    mockGetArtistTopTags.mockImplementation((name: string) =>
      Promise.resolve(
        name === "Radiohead"
          ? [{ name: "alternative", count: 100 }]
          : [{ name: "jazz", count: 100 }]
      )
    );

    const graph = await buildSimilarGraph(
      [{ name: "Radiohead", viewCount: 100 }],
      config
    );

    expect(graph[0].candidates.map((c) => c.name)).toEqual(["Jazz Cat"]);
  });

  it("caps candidates at exploreCandidateCount", async () => {
    mockGetArtistMbidByName.mockResolvedValue("mbid-seed");
    mockGetSimilarArtists.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) =>
        similar(`Artist ${i}`, `mbid-${i}`, 100 - i)
      )
    );
    mockGetArtistTopTags.mockResolvedValue([{ name: "jazz", count: 100 }]);

    const graph = await buildSimilarGraph(
      [{ name: "Radiohead", viewCount: 100 }],
      { ...config, exploreCandidateCount: 3 }
    );
    expect(graph[0].candidates).toHaveLength(3);
  });
});

describe("buildExploreResult", () => {
  const seed: SimilarGraphSeed = {
    seedArtist: "Radiohead",
    seedMbid: "mbid-seed",
    seedGenres: ["alternative", "rock"],
    viewCount: 100,
    candidates: [
      {
        name: "Rock Clone",
        artistMbid: "mbid-rock",
        score: 9000,
        genres: ["alternative", "rock"],
      },
      {
        name: "Jazz Cat",
        artistMbid: "mbid-jazz",
        score: 5000,
        genres: ["jazz", "bebop"],
      },
    ],
  };

  const notInLibrary = () => false;
  const noLibraryAlbum = () => null;

  it("returns null for an empty graph without any network call", async () => {
    const result = await buildExploreResult({
      similarGraph: [],
      config,
      recentlyShown: new Set(),
      artistInLibrary: notInLibrary,
      albumLibrary: noLibraryAlbum,
    });
    expect(result).toBeNull();
    expect(mockFetchReleaseGroupsForArtist).not.toHaveBeenCalled();
  });

  it("skips Various Artists left in an already-persisted graph", async () => {
    mockFetchReleaseGroupsForArtist.mockResolvedValue([]);

    const staleSeed: SimilarGraphSeed = {
      ...seed,
      candidates: [
        {
          name: "Various Artists",
          artistMbid: VARIOUS_ARTISTS_MBID,
          score: 9999,
          genres: ["jazz", "bebop"],
        },
      ],
    };

    const result = await buildExploreResult({
      similarGraph: [staleSeed],
      config,
      recentlyShown: new Set(),
      artistInLibrary: notInLibrary,
      albumLibrary: noLibraryAlbum,
    });

    expect(result).toBeNull();
    expect(mockFetchReleaseGroupsForArtist).not.toHaveBeenCalled();
  });

  it("picks the genre-distant candidate and surfaces an album", async () => {
    mockFetchReleaseGroupsForArtist.mockImplementation((mbid: string) =>
      Promise.resolve(
        mbid === "mbid-jazz"
          ? [
              {
                id: "rg-jazz-1",
                score: 1,
                title: "Blue Album",
                "primary-type": "Album",
                "first-release-date": "1965-03-01",
                "artist-credit": [],
              },
            ]
          : []
      )
    );

    const result = await buildExploreResult({
      similarGraph: [seed],
      config,
      recentlyShown: new Set(),
      artistInLibrary: notInLibrary,
      albumLibrary: noLibraryAlbum,
    });

    expect(result).not.toBeNull();
    expect(result!.result.mode).toBe("explore");
    expect(result!.result.album.artistName).toBe("Jazz Cat");
    expect(result!.rememberKey).toBe("rg-jazz-1");
    expect(mockFetchReleaseGroupsForArtist).not.toHaveBeenCalledWith(
      "mbid-rock"
    );
  });
});
