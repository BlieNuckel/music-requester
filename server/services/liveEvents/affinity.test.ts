import { describe, it, expect } from "vitest";
import {
  normalizeGenre,
  buildGenreWeights,
  scoreEventAffinity,
  rankByAffinity,
} from "./affinity";
import type { HydratedLiveEvent } from "../../db/liveEvents";

function event(
  genresByPerformer: (string[] | null)[],
  overrides: Record<string, unknown> = {}
): HydratedLiveEvent {
  return {
    event_key: "jambase:100",
    event_date: "2026-09-01",
    performers: genresByPerformer.map((genres, index) => ({
      artist_jambase_id: `jambase:${index}`,
      artist_name: `Artist ${index}`,
      genres: genres === null ? null : JSON.stringify(genres),
    })),
    ...overrides,
  } as unknown as HydratedLiveEvent;
}

const VECTOR = [
  { tag: "shoegaze", weight: 100 },
  { tag: "dream pop", weight: 50 },
  { tag: "indie rock", weight: 10 },
];

describe("normalizeGenre", () => {
  it("brings JamBase slugs and profile tags into one shape", () => {
    expect(normalizeGenre("indie-rock")).toBe("indie rock");
    expect(normalizeGenre("Indie_Rock")).toBe("indie rock");
    expect(normalizeGenre("  Shoegaze ")).toBe("shoegaze");
  });

  it("canonicalizes so an event and a profile spelled differently still match", () => {
    // JamBase says drum-and-bass, the profile stores what MusicBrainz calls it. Before the
    // shared vocabulary these were two strings and the event silently failed to match.
    expect(normalizeGenre("drum-and-bass")).toBe(normalizeGenre("DnB"));
    expect(normalizeGenre("hip-hop")).toBe(normalizeGenre("rap"));
  });

  it("leaves a slug no vocabulary claims alone rather than inventing a match", () => {
    expect(normalizeGenre("tribute-act")).toBe("tribute act");
  });
});

describe("buildGenreWeights", () => {
  it("scales weights relative to the strongest tag", () => {
    const weights = buildGenreWeights(VECTOR);

    expect(weights.get("shoegaze")).toBe(1);
    expect(weights.get("dream pop")).toBe(0.5);
    expect(weights.get("indie rock")).toBeCloseTo(0.1);
  });

  it("returns nothing for an empty or zeroed vector", () => {
    expect(buildGenreWeights([]).size).toBe(0);
    expect(buildGenreWeights([{ tag: "x", weight: 0 }]).size).toBe(0);
  });

  it("keeps the highest weight when tags normalize to the same thing", () => {
    const weights = buildGenreWeights([
      { tag: "indie-rock", weight: 40 },
      { tag: "Indie Rock", weight: 80 },
    ]);
    expect(weights.size).toBe(1);
    expect(weights.get("indie rock")).toBe(1);
  });
});

describe("scoreEventAffinity", () => {
  const weights = buildGenreWeights(VECTOR);

  it("scores on the best matching genre, not the sum", () => {
    const strong = scoreEventAffinity(event([["shoegaze"]]), weights);
    const verbose = scoreEventAffinity(
      event([["dream pop", "indie rock", "indie rock"]]),
      weights
    );

    expect(strong.affinity).toBe(1);
    expect(verbose.affinity).toBe(0.5);
  });

  it("matches across hyphenation", () => {
    expect(scoreEventAffinity(event([["dream-pop"]]), weights).affinity).toBe(
      0.5
    );
  });

  it("considers every performer on the bill", () => {
    const scored = scoreEventAffinity(
      event([["polka"], ["shoegaze"]]),
      weights
    );
    expect(scored.affinity).toBe(1);
  });

  it("reports which genres matched", () => {
    const scored = scoreEventAffinity(
      event([["shoegaze", "noise", "dream-pop"]]),
      weights
    );
    expect(scored.matchedGenres.sort()).toEqual(["dream-pop", "shoegaze"]);
  });

  it("scores zero for no overlap, missing genres, or an empty profile", () => {
    expect(scoreEventAffinity(event([["polka"]]), weights).affinity).toBe(0);
    expect(scoreEventAffinity(event([null]), weights).affinity).toBe(0);
    expect(scoreEventAffinity(event([[]]), weights).affinity).toBe(0);
    expect(scoreEventAffinity(event([["shoegaze"]]), new Map()).affinity).toBe(
      0
    );
  });
});

describe("rankByAffinity", () => {
  const weights = buildGenreWeights(VECTOR);

  it("orders by taste rather than by date", () => {
    const ranked = rankByAffinity(
      [
        event([["indie rock"]], {
          event_key: "weak",
          event_date: "2026-09-01",
        }),
        event([["shoegaze"]], {
          event_key: "strong",
          event_date: "2026-09-20",
        }),
      ],
      weights,
      0
    );

    expect(ranked.map((entry) => entry.event.event_key)).toEqual([
      "strong",
      "weak",
    ]);
  });

  it("breaks ties by date", () => {
    const ranked = rankByAffinity(
      [
        event([["shoegaze"]], { event_key: "later", event_date: "2026-09-20" }),
        event([["shoegaze"]], {
          event_key: "sooner",
          event_date: "2026-09-01",
        }),
      ],
      weights,
      0
    );

    expect(ranked[0].event.event_key).toBe("sooner");
  });

  it("drops everything under the floor rather than padding the shelf", () => {
    const ranked = rankByAffinity(
      [event([["indie rock"]]), event([["polka"]])],
      weights,
      0.4
    );
    expect(ranked).toEqual([]);
  });

  it("keeps an event exactly at the floor", () => {
    expect(rankByAffinity([event([["dream pop"]])], weights, 0.5)).toHaveLength(
      1
    );
  });

  it("returns everything when the floor is zero", () => {
    expect(rankByAffinity([event([["polka"]])], weights, 0)).toHaveLength(1);
  });
});
