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

import { buildSimilarGraph } from "./explore";
import { PICK_BODIES, type PickCtx } from "./pickGraph";
import { runGraph } from "../recommenderGraph/runtime/executor";
import { RESOLUTION_BUDGET } from "./budget";
import { VARIOUS_ARTISTS_MBID } from "../utils/artistFilter";
import type { DerivedProfile } from "../db/entity/UserProfile";
import type { BuiltAlbum } from "./types";

const config = {
  genericTags: ["seen live"],
  exploreCandidateCount: 12,
  genreOverlapThreshold: 0.15,
  libraryPreference: "prefer_new",
} as unknown as PromotedAlbumConfig;

type ExploreCase = {
  similarGraph: SimilarGraphSeed[];
  config?: PromotedAlbumConfig;
  recentlyShown?: Set<string>;
  artistInLibrary?: (mbid: string) => boolean;
  budget?: { remaining: number };
  exploring?: boolean;
};

/**
 * The explore source as the recommender runs it: the registry decides which steps a request
 * for an explore album pulls in, so the seed draw, the genre line and the album walk are
 * exercised in the order and with the wiring the carousel actually uses.
 */
async function runExplore(input: ExploreCase): Promise<BuiltAlbum | null> {
  const ctx: PickCtx = {
    userId: 1,
    config: input.config ?? config,
    library: {
      artistInLibrary: input.artistInLibrary ?? (() => false),
      albumLibrary: () => null,
    },
    budget: input.budget ?? { remaining: RESOLUTION_BUDGET },
    rng: Math.random,
    priority: "interactive",
    count: 1,
    recentAlbums: [],
    excluded: input.recentlyShown ?? new Set(),
    exploring: input.exploring ?? true,
  };

  const { outputs } = await runGraph(
    ["exploreAlbum"],
    PICK_BODIES,
    ctx,
    new Map([
      [
        "profileFreshness",
        { similarGraph: input.similarGraph } as DerivedProfile,
      ],
    ])
  );
  return outputs.get("exploreAlbum") as BuiltAlbum | null;
}

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
          ? [{ name: "alternative rock", count: 100 }]
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
        seedGenres: ["alternative rock"],
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

  it("overlaps a seed and candidate that spell one genre differently", async () => {
    mockGetArtistMbidByName.mockResolvedValue("mbid-seed");
    mockGetSimilarArtists.mockResolvedValue([
      similar("Bass Cat", "mbid-bass", 9000),
    ]);
    mockGetArtistTopTags.mockImplementation((name: string) =>
      Promise.resolve(
        name === "Radiohead"
          ? [{ name: "DnB", count: 100 }]
          : [{ name: "Drum and bass", count: 100 }]
      )
    );

    const graph = await buildSimilarGraph(
      [{ name: "Radiohead", viewCount: 100 }],
      config
    );

    expect(graph[0].seedGenres).toEqual(["drum and bass"]);
    expect(graph[0].candidates[0].genres).toEqual(["drum and bass"]);
  });

  it("leaves a non-genre tag out of the sets that decide genre overlap", async () => {
    mockGetArtistMbidByName.mockResolvedValue("mbid-seed");
    mockGetSimilarArtists.mockResolvedValue([
      similar("Jazz Cat", "mbid-jazz", 9000),
    ]);
    mockGetArtistTopTags.mockResolvedValue([
      { name: "nigerian", count: 100 },
      { name: "jazz", count: 90 },
    ]);

    const graph = await buildSimilarGraph(
      [{ name: "Radiohead", viewCount: 100 }],
      config
    );

    expect(graph[0].seedGenres).toEqual(["jazz"]);
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
          ? [{ name: "alternative rock", count: 100 }]
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

describe("the explore source", () => {
  const seed: SimilarGraphSeed = {
    seedArtist: "Radiohead",
    seedMbid: "mbid-seed",
    seedGenres: ["alternative rock", "rock"],
    viewCount: 100,
    candidates: [
      {
        name: "Rock Clone",
        artistMbid: "mbid-rock",
        score: 9000,
        genres: ["alternative rock", "rock"],
      },
      {
        name: "Jazz Cat",
        artistMbid: "mbid-jazz",
        score: 5000,
        genres: ["jazz", "bebop"],
      },
    ],
  };

  it("returns null for an empty graph without any network call", async () => {
    const result = await runExplore({ similarGraph: [] });
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

    const result = await runExplore({ similarGraph: [staleSeed] });

    expect(result).toBeNull();
    expect(mockFetchReleaseGroupsForArtist).not.toHaveBeenCalled();
  });

  /**
   * Explore used to take `primary-type === "Album"` and nothing else, while the personal and
   * tag paths both took the shared type filter — so the same artist could yield a record from
   * one source and nothing from another. An EP by a genre-distant artist demonstrates that
   * genre as well as an album does.
   */
  it("surfaces an EP, which the album-only rule used to drop", async () => {
    mockFetchReleaseGroupsForArtist.mockImplementation((mbid: string) =>
      Promise.resolve(
        mbid === "mbid-jazz"
          ? [
              {
                id: "rg-jazz-ep",
                score: 1,
                title: "Blue EP",
                "primary-type": "EP",
                "first-release-date": "1965-03-01",
                "artist-credit": [],
              },
            ]
          : []
      )
    );

    const result = await runExplore({ similarGraph: [seed] });

    expect(result!.rememberKey).toBe("rg-jazz-ep");
  });

  it("still refuses a live record, whatever its primary type says", async () => {
    mockFetchReleaseGroupsForArtist.mockImplementation((mbid: string) =>
      Promise.resolve(
        mbid === "mbid-jazz"
          ? [
              {
                id: "rg-jazz-live",
                score: 1,
                title: "Blue Album (Live)",
                "primary-type": "Album",
                "secondary-types": ["Live"],
                "first-release-date": "1966-03-01",
                "artist-credit": [],
              },
            ]
          : []
      )
    );

    const result = await runExplore({ similarGraph: [seed] });

    expect(result).toBeNull();
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

    const result = await runExplore({ similarGraph: [seed] });

    expect(result).not.toBeNull();
    expect(result!.result.mode).toBe("explore");
    expect(result!.result.album.artistName).toBe("Jazz Cat");
    expect(result!.rememberKey).toBe("rg-jazz-1");
    expect(mockFetchReleaseGroupsForArtist).not.toHaveBeenCalledWith(
      "mbid-rock"
    );
  });

  it("stops walking candidates once the shared resolution budget is spent", async () => {
    mockFetchReleaseGroupsForArtist.mockResolvedValue([]);

    const result = await runExplore({
      similarGraph: [seed],
      budget: { remaining: 0 },
    });

    expect(result).toBeNull();
    expect(mockFetchReleaseGroupsForArtist).not.toHaveBeenCalled();
  });

  it("spends one unit of the budget per candidate it tries", async () => {
    mockFetchReleaseGroupsForArtist.mockResolvedValue([]);
    const budget = { remaining: 5 };

    await runExplore({ similarGraph: [seed], budget });

    expect(budget.remaining).toBe(
      5 - mockFetchReleaseGroupsForArtist.mock.calls.length
    );
  });
  describe("the library preference", () => {
    const twoDistant: SimilarGraphSeed = {
      ...seed,
      candidates: [
        {
          name: "Jazz Owned",
          artistMbid: "mbid-jazz-owned",
          score: 9000,
          genres: ["jazz", "bebop"],
        },
        {
          name: "Jazz Cat",
          artistMbid: "mbid-jazz",
          score: 5000,
          genres: ["jazz", "bebop"],
        },
      ],
    };

    beforeEach(() => {
      mockFetchReleaseGroupsForArtist.mockImplementation((mbid: string) =>
        Promise.resolve([
          {
            id: `rg-${mbid}`,
            score: 1,
            title: `Record by ${mbid}`,
            "primary-type": "Album",
            "first-release-date": "1965-03-01",
            "artist-credit": [],
          },
        ])
      );
    });

    /**
     * Explore used to read the preference only to label the trace, so a user asking for
     * records they do not own got them from the personal source and not from this one — the
     * closest neighbour won whether or not they already had it.
     */
    it("skips a distant artist the user already owns under prefer_new", async () => {
      const result = await runExplore({
        similarGraph: [twoDistant],
        artistInLibrary: (mbid) => mbid === "mbid-jazz-owned",
      });

      expect(result!.result.album.artistName).toBe("Jazz Cat");
      expect(mockFetchReleaseGroupsForArtist).not.toHaveBeenCalledWith(
        "mbid-jazz-owned",
        expect.anything()
      );
    });

    it("relaxes rather than giving up when every distant artist is owned", async () => {
      const result = await runExplore({
        similarGraph: [twoDistant],
        artistInLibrary: () => true,
      });

      expect(result!.result.album.artistName).toBe("Jazz Owned");
    });
  });

  it("sits out a slot the quota did not grant a jump", async () => {
    const result = await runExplore({
      similarGraph: [seed],
      exploring: false,
    });

    expect(result).toBeNull();
    expect(mockFetchReleaseGroupsForArtist).not.toHaveBeenCalled();
  });
});
