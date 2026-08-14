import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PromotedAlbumConfig } from "../config";
import type { SimilarGraphSeed } from "../db/entity/UserProfile";
import type { MusicBrainzReleaseGroup } from "../api/musicbrainz/types";
import type { PersonalResult } from "./types";

const mockFetchReleaseGroupsForArtist = vi.fn();

vi.mock("../api/musicbrainz/releaseGroups", () => ({
  fetchReleaseGroupsForArtist: (...args: unknown[]) =>
    mockFetchReleaseGroupsForArtist(...args),
}));

import {
  buildPersonalResult,
  collectCandidates,
  eligibleAlbums,
  preferredPool,
  withinTastePool,
  type PersonalContext,
} from "./personal";
import { preferenceRule } from "./preference";

const config = {
  genreOverlapThreshold: 0.15,
  libraryPreference: "prefer_new",
} as unknown as PromotedAlbumConfig;

function seed(
  seedArtist: string,
  viewCount: number,
  seedGenres: string[],
  candidates: {
    name: string;
    artistMbid: string;
    score: number;
    genres: string[];
  }[]
): SimilarGraphSeed {
  return {
    seedArtist,
    seedMbid: `mbid-${seedArtist.toLowerCase()}`,
    seedGenres,
    viewCount,
    candidates,
  };
}

function releaseGroup(
  id: string,
  title: string,
  overrides: Partial<MusicBrainzReleaseGroup> = {}
): MusicBrainzReleaseGroup {
  return {
    id,
    score: 1,
    title,
    "primary-type": "Album",
    "first-release-date": "2001-05-05",
    "artist-credit": [],
    ...overrides,
  } as MusicBrainzReleaseGroup;
}

const nearNeighbour = {
  name: "Near Band",
  artistMbid: "mbid-near",
  score: 0.9,
  genres: ["shoegaze", "dream pop"],
};

const farNeighbour = {
  name: "Far Band",
  artistMbid: "mbid-far",
  score: 0.8,
  genres: ["bebop", "swing"],
};

function context(overrides: Partial<PersonalContext> = {}): PersonalContext {
  return {
    similarGraph: [
      seed("Slowdive", 100, ["shoegaze", "dream pop"], [nearNeighbour]),
    ],
    knownAlbums: new Set<string>(),
    config,
    recentlyShown: new Set<string>(),
    artistInLibrary: () => false,
    albumLibrary: () => null,
    rng: () => 0,
    ...overrides,
  };
}

function personal(result: { result: unknown } | null): PersonalResult {
  if (!result) throw new Error("expected a personal result");
  return result.result as PersonalResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchReleaseGroupsForArtist.mockResolvedValue([
    releaseGroup("rg-1", "Souvlaki"),
  ]);
});

describe("collectCandidates", () => {
  it("weights a neighbour by the seed's play weight times the tie strength", () => {
    const [candidate] = collectCandidates([
      seed("Slowdive", 100, ["shoegaze"], [nearNeighbour]),
    ]);
    expect(candidate.weight).toBeCloseTo(90, 10);
    expect(candidate.seedArtist).toBe("Slowdive");
  });

  it("sums the weight of a neighbour reachable from several seeds", () => {
    const [candidate] = collectCandidates([
      seed("Slowdive", 100, ["shoegaze"], [nearNeighbour]),
      seed("Ride", 50, ["shoegaze"], [nearNeighbour]),
    ]);
    expect(candidate.weight).toBeCloseTo(90 + 45, 10);
  });

  it("credits the seed that contributed most", () => {
    const [candidate] = collectCandidates([
      seed("Ride", 10, ["noise pop"], [nearNeighbour]),
      seed("Slowdive", 100, ["shoegaze"], [nearNeighbour]),
    ]);
    expect(candidate.seedArtist).toBe("Slowdive");
    expect([...candidate.seedGenres]).toEqual(["shoegaze"]);
  });

  it("drops placeholder artists", () => {
    const candidates = collectCandidates([
      seed(
        "Slowdive",
        100,
        ["shoegaze"],
        [{ ...nearNeighbour, name: "Various Artists" }]
      ),
    ]);
    expect(candidates).toEqual([]);
  });
});

describe("withinTastePool", () => {
  it("keeps the neighbours that share enough genres with their seed", () => {
    const candidates = collectCandidates([
      seed(
        "Slowdive",
        100,
        ["shoegaze", "dream pop"],
        [nearNeighbour, farNeighbour]
      ),
    ]);
    const { pool, widened } = withinTastePool(candidates, 0.15);
    expect(pool.map((c) => c.candidate.name)).toEqual(["Near Band"]);
    expect(widened).toBe(false);
  });

  it("widens to the whole graph rather than giving up when none is close", () => {
    const candidates = collectCandidates([
      seed("Slowdive", 100, ["shoegaze"], [farNeighbour]),
    ]);
    const { pool, widened } = withinTastePool(candidates, 0.15);
    expect(pool).toHaveLength(1);
    expect(widened).toBe(true);
  });
});

describe("preferredPool", () => {
  const owned = { ...nearNeighbour, name: "Owned", artistMbid: "mbid-owned" };
  const inLibrary = (mbid: string) => mbid === "mbid-owned";

  it("keeps only the artists the user does not own under prefer_new", () => {
    const candidates = collectCandidates([
      seed("Slowdive", 100, ["shoegaze"], [owned, nearNeighbour]),
    ]);
    const { pool, relaxed } = preferredPool(
      candidates,
      preferenceRule("prefer_new", inLibrary)
    );
    expect(pool.map((c) => c.candidate.name)).toEqual(["Near Band"]);
    expect(relaxed).toBe(false);
  });

  it("keeps the owned artists under prefer_library", () => {
    const candidates = collectCandidates([
      seed("Slowdive", 100, ["shoegaze"], [owned, nearNeighbour]),
    ]);
    const { pool } = preferredPool(
      candidates,
      preferenceRule("prefer_library", inLibrary)
    );
    expect(pool.map((c) => c.candidate.name)).toEqual(["Owned"]);
  });

  it("relaxes rather than emptying when every neighbour is on the wrong side", () => {
    const candidates = collectCandidates([
      seed("Slowdive", 100, ["shoegaze"], [owned]),
    ]);
    const { pool, relaxed } = preferredPool(
      candidates,
      preferenceRule("prefer_new", inLibrary)
    );
    expect(pool).toHaveLength(1);
    expect(relaxed).toBe(true);
  });
});

describe("eligibleAlbums", () => {
  it("keeps albums and EPs but drops live and compilation packages", () => {
    const groups = [
      releaseGroup("rg-1", "Studio"),
      releaseGroup("rg-2", "An EP", { "primary-type": "EP" }),
      releaseGroup("rg-3", "Live In Tokyo", {
        "secondary-types": ["Live"],
      }),
      releaseGroup("rg-4", "Greatest Hits", {
        "primary-type": "Album",
        "secondary-types": ["Compilation"],
      }),
    ];
    expect(
      eligibleAlbums(groups, "Near Band", new Set()).map((rg) => rg.id)
    ).toEqual(["rg-1", "rg-2"]);
  });

  it("drops undated release groups", () => {
    const groups = [
      releaseGroup("rg-1", "Unreleased", {
        "first-release-date": "",
      }),
    ];
    expect(eligibleAlbums(groups, "Near Band", new Set())).toEqual([]);
  });

  it("drops albums the user already listens to, matching on normalized text", () => {
    const groups = [releaseGroup("rg-1", "Sóuvlaki!")];
    expect(
      eligibleAlbums(groups, "Near Band", new Set(["near band::souvlaki"]))
    ).toEqual([]);
  });
});

describe("buildPersonalResult", () => {
  it("returns null when the graph is empty", async () => {
    const result = await buildPersonalResult(context({ similarGraph: [] }));
    expect(result).toBeNull();
  });

  it("surfaces an album by a neighbour of an artist the user plays", async () => {
    const built = await buildPersonalResult(context());

    expect(built!.rememberKey).toBe("rg-1");
    const result = personal(built);
    expect(result.mode).toBe("personal");
    expect(result.seedArtist).toBe("Slowdive");
    expect(result.album).toMatchObject({
      name: "Souvlaki",
      mbid: "rg-1",
      artistName: "Near Band",
      artistMbid: "mbid-near",
      year: "2001",
    });
    expect(result.sharedGenres).toEqual(["shoegaze", "dream pop"]);
    expect(mockFetchReleaseGroupsForArtist).toHaveBeenCalledWith(
      "mbid-near",
      "interactive"
    );
  });

  it("never consults the global tag charts", async () => {
    await buildPersonalResult(context());
    // The only network call this source makes is the candidate's discography.
    expect(mockFetchReleaseGroupsForArtist).toHaveBeenCalledTimes(1);
  });

  it("traces the seed, the neighbours considered, and the one chosen", async () => {
    const built = await buildPersonalResult(
      context({
        similarGraph: [
          seed("Slowdive", 100, ["shoegaze", "dream pop"], [nearNeighbour]),
        ],
      })
    );

    const { trace } = personal(built);
    expect(trace.kind).toBe("personal");
    expect(trace.seedArtist).toBe("Slowdive");
    expect(trace.chosenArtist).toBe("Near Band");
    expect(trace.widened).toBe(false);
    expect(trace.candidates).toEqual([
      expect.objectContaining({
        name: "Near Band",
        chosen: true,
        isDifferentGenre: false,
      }),
    ]);
  });

  it("records that the pool widened when no neighbour was close enough", async () => {
    const built = await buildPersonalResult(
      context({
        similarGraph: [seed("Slowdive", 100, ["shoegaze"], [farNeighbour])],
      })
    );
    expect(personal(built).trace.widened).toBe(true);
  });

  it("skips an album the user already listens to", async () => {
    mockFetchReleaseGroupsForArtist.mockResolvedValue([
      releaseGroup("rg-known", "Souvlaki"),
      releaseGroup("rg-new", "Pygmalion"),
    ]);

    const built = await buildPersonalResult(
      context({ knownAlbums: new Set(["near band::souvlaki"]) })
    );
    expect(personal(built).album.mbid).toBe("rg-new");
  });

  it("prefers an album that has not been shown recently", async () => {
    mockFetchReleaseGroupsForArtist.mockResolvedValue([
      releaseGroup("rg-old", "Souvlaki"),
      releaseGroup("rg-fresh", "Pygmalion"),
    ]);

    const built = await buildPersonalResult(
      context({ recentlyShown: new Set(["rg-old"]) })
    );
    expect(personal(built).album.mbid).toBe("rg-fresh");
  });

  it("repeats a recent album rather than returning nothing", async () => {
    const built = await buildPersonalResult(
      context({ recentlyShown: new Set(["rg-1"]) })
    );
    expect(personal(built).album.mbid).toBe("rg-1");
  });

  it("moves on to the next neighbour when one has no eligible album", async () => {
    mockFetchReleaseGroupsForArtist.mockImplementation((mbid: string) =>
      Promise.resolve(mbid === "mbid-near" ? [] : [releaseGroup("rg-2", "B")])
    );

    const built = await buildPersonalResult(
      context({
        similarGraph: [
          seed(
            "Slowdive",
            100,
            ["shoegaze", "dream pop"],
            [
              nearNeighbour,
              { ...nearNeighbour, name: "Other", artistMbid: "mbid-other" },
            ]
          ),
        ],
      })
    );

    expect(personal(built).album.artistName).toBe("Other");
    expect(mockFetchReleaseGroupsForArtist).toHaveBeenCalledTimes(2);
  });

  it("never draws an artist the user already owns under prefer_new", async () => {
    const owned = Array.from({ length: 5 }, (_, i) => ({
      ...nearNeighbour,
      name: `Owned ${i}`,
      artistMbid: `mbid-owned-${i}`,
      score: 1,
    }));

    const built = await buildPersonalResult(
      context({
        similarGraph: [
          seed(
            "Slowdive",
            100,
            ["shoegaze", "dream pop"],
            [...owned, { ...nearNeighbour, score: 0.01 }]
          ),
        ],
        artistInLibrary: (mbid) => mbid.startsWith("mbid-owned"),
      })
    );

    const result = personal(built);
    expect(result.album.artistName).toBe("Near Band");
    expect(result.trace.selectionReason).toBe("preferred_non_library");
    expect(result.trace.relaxedPreference).toBe(false);
    expect(mockFetchReleaseGroupsForArtist).toHaveBeenCalledTimes(1);
  });

  it("falls back to owned neighbours rather than returning nothing", async () => {
    const built = await buildPersonalResult(
      context({
        similarGraph: [
          seed(
            "Slowdive",
            100,
            ["shoegaze", "dream pop"],
            [{ ...nearNeighbour, name: "Owned", artistMbid: "mbid-owned" }]
          ),
        ],
        artistInLibrary: (mbid) => mbid === "mbid-owned",
      })
    );

    const result = personal(built);
    expect(result.album.artistName).toBe("Owned");
    expect(result.trace.relaxedPreference).toBe(true);
    expect(result.trace.selectionReason).toBe("fallback_in_library");
  });

  it("spends one unit of the shared budget per neighbour tried", async () => {
    const budget = { remaining: 5 };
    await buildPersonalResult(context({ budget }));
    expect(budget.remaining).toBe(4);
  });

  it("gives up without a lookup once the budget is spent", async () => {
    const budget = { remaining: 0 };
    const built = await buildPersonalResult(context({ budget }));

    expect(built).toBeNull();
    expect(mockFetchReleaseGroupsForArtist).not.toHaveBeenCalled();
  });
});
