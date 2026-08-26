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
  collectCandidates,
  eligibleAlbums,
  preferredPool,
  withinTastePool,
} from "./personal";
import { preferenceRule } from "./preference";
import { PICK_BODIES, type PickCtx } from "./pickGraph";
import { PICK_EXPLAINERS } from "./pickExplain";
import { runGraph } from "../recommenderGraph/runtime/executor";
import type { TraceFact } from "../../shared/recommendationTrace";
import { RESOLUTION_BUDGET } from "./budget";
import type { DerivedProfile } from "../db/entity/UserProfile";
import type { Rng } from "../utils/random";
import type { BuiltAlbum } from "./types";

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

type PersonalCase = {
  similarGraph?: SimilarGraphSeed[];
  knownAlbums?: Set<string>;
  recentlyShown?: Set<string>;
  artistInLibrary?: (mbid: string) => boolean;
  budget?: { remaining: number };
  rng?: Rng;
};

/**
 * The personal source as the recommender runs it: the registry decides which steps a request
 * for a neighbour's album pulls in, so collapsing the graph, the genre line, the library line
 * and the album walk are exercised with the wiring the carousel actually uses.
 */
type PersonalRun = {
  built: BuiltAlbum | null;
  /** What a node had to say about its own turn, which is the trace now. */
  facts: (nodeId: string) => TraceFact[];
};

async function runPersonalGraph(
  input: PersonalCase = {}
): Promise<PersonalRun> {
  const ctx: PickCtx = {
    userId: 1,
    config,
    library: {
      artistInLibrary: input.artistInLibrary ?? (() => false),
      albumLibrary: () => null,
    },
    budget: input.budget ?? { remaining: RESOLUTION_BUDGET },
    rng: input.rng ?? (() => 0),
    priority: "interactive",
    count: 1,
    recentAlbums: [],
    excluded: input.recentlyShown ?? new Set(),
    exploring: false,
  };

  const profile = {
    similarGraph: input.similarGraph ?? [
      seed("Slowdive", 100, ["shoegaze", "dream pop"], [nearNeighbour]),
    ],
    knownAlbums: [...(input.knownAlbums ?? [])],
  } as DerivedProfile;

  const { outputs, trace } = await runGraph(
    ["personalAlbum"],
    PICK_BODIES,
    ctx,
    new Map([["profileFreshness", profile]]),
    PICK_EXPLAINERS
  );

  return {
    built: outputs.get("personalAlbum") as BuiltAlbum | null,
    facts: (nodeId) => trace.find((run) => run.nodeId === nodeId)?.facts ?? [],
  };
}

const runPersonal = (input: PersonalCase = {}): Promise<BuiltAlbum | null> =>
  runPersonalGraph(input).then((run) => run.built);

/** One node's fact by its label, which is how a reader finds it on the card. */
const fact = (facts: TraceFact[], label: string): TraceFact | undefined =>
  facts.find((entry) => entry.label === label);

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

describe("the personal source", () => {
  it("returns null when the graph is empty", async () => {
    const result = await runPersonal({ similarGraph: [] });
    expect(result).toBeNull();
  });

  it("surfaces an album by a neighbour of an artist the user plays", async () => {
    const built = await runPersonal();

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
    await runPersonal();
    // The only network call this source makes is the candidate's discography.
    expect(mockFetchReleaseGroupsForArtist).toHaveBeenCalledTimes(1);
  });

  it("explains the seed, the neighbours considered, and the one chosen", async () => {
    const { facts } = await runPersonalGraph({
      similarGraph: [
        seed("Slowdive", 100, ["shoegaze", "dream pop"], [nearNeighbour]),
      ],
    });

    const album = facts("personalAlbum");
    expect(fact(album, "Next to")?.value).toBe("Slowdive");
    expect(fact(album, "Genres you share")?.value).toBe("shoegaze, dream pop");
    expect(fact(album, "Neighbours drawn from")?.items).toEqual([
      expect.objectContaining({ name: "Near Band", chosen: true }),
    ]);
  });

  it("says so when the pool widened because no neighbour was close enough", async () => {
    const { facts } = await runPersonalGraph({
      similarGraph: [seed("Slowdive", 100, ["shoegaze"], [farNeighbour])],
    });

    expect(
      fact(facts("personalBand"), "Close enough to your taste")?.value
    ).toMatch(/none were/i);
  });

  it("skips an album the user already listens to", async () => {
    mockFetchReleaseGroupsForArtist.mockResolvedValue([
      releaseGroup("rg-known", "Souvlaki"),
      releaseGroup("rg-new", "Pygmalion"),
    ]);

    const built = await runPersonal({
      knownAlbums: new Set(["near band::souvlaki"]),
    });
    expect(personal(built).album.mbid).toBe("rg-new");
  });

  it("prefers an album that has not been shown recently", async () => {
    mockFetchReleaseGroupsForArtist.mockResolvedValue([
      releaseGroup("rg-old", "Souvlaki"),
      releaseGroup("rg-fresh", "Pygmalion"),
    ]);

    const built = await runPersonal({ recentlyShown: new Set(["rg-old"]) });
    expect(personal(built).album.mbid).toBe("rg-fresh");
  });

  it("repeats a recent album rather than returning nothing", async () => {
    const built = await runPersonal({ recentlyShown: new Set(["rg-1"]) });
    expect(personal(built).album.mbid).toBe("rg-1");
  });

  it("moves on to the next neighbour when one has no eligible album", async () => {
    mockFetchReleaseGroupsForArtist.mockImplementation((mbid: string) =>
      Promise.resolve(mbid === "mbid-near" ? [] : [releaseGroup("rg-2", "B")])
    );

    const built = await runPersonal({
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
    });

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

    const built = await runPersonal({
      similarGraph: [
        seed(
          "Slowdive",
          100,
          ["shoegaze", "dream pop"],
          [...owned, { ...nearNeighbour, score: 0.01 }]
        ),
      ],
      artistInLibrary: (mbid) => mbid.startsWith("mbid-owned"),
    });

    const result = personal(built);
    expect(result.album.artistName).toBe("Near Band");
    expect(mockFetchReleaseGroupsForArtist).toHaveBeenCalledTimes(1);
  });

  it("falls back to owned neighbours rather than returning nothing", async () => {
    const built = await runPersonal({
      similarGraph: [
        seed(
          "Slowdive",
          100,
          ["shoegaze", "dream pop"],
          [{ ...nearNeighbour, name: "Owned", artistMbid: "mbid-owned" }]
        ),
      ],
      artistInLibrary: (mbid) => mbid === "mbid-owned",
    });

    expect(personal(built).album.artistName).toBe("Owned");
  });

  it("explains a pick that had to take a neighbour the user owns", async () => {
    const { facts } = await runPersonalGraph({
      similarGraph: [
        seed(
          "Slowdive",
          100,
          ["shoegaze", "dream pop"],
          [{ ...nearNeighbour, name: "Owned", artistMbid: "mbid-owned" }]
        ),
      ],
      artistInLibrary: (mbid) => mbid === "mbid-owned",
    });

    expect(fact(facts("personalPreference"), "Library side")?.value).toMatch(
      /wrong side/i
    );
    expect(fact(facts("personalAlbum"), "Library")?.value).toMatch(
      /already in your library/i
    );
  });

  it("spends one unit of the shared budget per neighbour tried", async () => {
    const budget = { remaining: 5 };
    await runPersonal({ budget });
    expect(budget.remaining).toBe(4);
  });

  it("gives up without a lookup once the budget is spent", async () => {
    const budget = { remaining: 0 };
    const built = await runPersonal({ budget });

    expect(built).toBeNull();
    expect(mockFetchReleaseGroupsForArtist).not.toHaveBeenCalled();
  });
});
