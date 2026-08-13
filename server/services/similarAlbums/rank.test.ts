import { describe, it, expect } from "vitest";
import { rankCandidates } from "./rank";
import type { AlbumCandidate, SeedAlbum } from "./types";

const seed: SeedAlbum = {
  mbid: "seed-rg",
  title: "Souvlaki",
  artistName: "Slowdive",
  artistMbid: "slowdive-mbid",
};

function candidate(overrides: Partial<AlbumCandidate> = {}): AlbumCandidate {
  return {
    title: "Loveless",
    artistName: "My Bloody Valentine",
    artistMbid: "mbv-mbid",
    mbid: "mbv-loveless",
    score: 0.5,
    reason: "tag",
    ...overrides,
  };
}

describe("rankCandidates", () => {
  it("keeps a single candidate with its weighted leg score", () => {
    const [result] = rankCandidates([candidate({ score: 1 })], seed);
    expect(result.score).toBeCloseTo(0.5);
    expect(result.reasons).toEqual(["tag"]);
  });

  it("merges the same album across legs and boosts it", () => {
    const ranked = rankCandidates(
      [
        candidate({ score: 1, reason: "tag" }),
        candidate({ score: 1, reason: "artist", mbid: "" }),
      ],
      seed
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0].reasons).toEqual(["tag", "artist"]);
    expect(ranked[0].score).toBeCloseTo(1.25);
  });

  it("merges on normalized title even when only one side carries an mbid", () => {
    const ranked = rankCandidates(
      [
        candidate({ mbid: "", reason: "tag" }),
        candidate({
          title: "loveless!",
          artistName: "my bloody valentine",
          mbid: "mbv-loveless",
          reason: "artist",
        }),
      ],
      seed
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0].mbid).toBe("mbv-loveless");
  });

  it("keeps the best score per leg when a leg proposes a duplicate", () => {
    const ranked = rankCandidates(
      [
        candidate({ score: 0.2, reason: "tag" }),
        candidate({ score: 0.9, reason: "tag" }),
      ],
      seed
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0].score).toBeCloseTo(0.45);
  });

  it("drops albums by the seed artist, matched on mbid", () => {
    const ranked = rankCandidates(
      [
        candidate({
          title: "Pygmalion",
          artistName: "Slowdive",
          artistMbid: "slowdive-mbid",
        }),
      ],
      seed
    );

    expect(ranked).toEqual([]);
  });

  it("drops albums by the seed artist by name when mbids are missing", () => {
    const ranked = rankCandidates(
      [
        candidate({
          title: "Pygmalion",
          artistName: "slowdive",
          artistMbid: "",
        }),
      ],
      { ...seed, artistMbid: "" }
    );

    expect(ranked).toEqual([]);
  });

  it("drops the seed album itself", () => {
    const ranked = rankCandidates(
      [
        candidate({
          title: "Souvlaki",
          artistName: "Mojave 3",
          artistMbid: "mojave-mbid",
          mbid: "seed-rg",
        }),
      ],
      seed
    );

    expect(ranked).toEqual([]);
  });

  it("drops placeholder artists and entries missing a title", () => {
    const ranked = rankCandidates(
      [
        candidate({ artistName: "Various Artists", artistMbid: "" }),
        candidate({ title: "", artistName: "Real Artist", artistMbid: "" }),
      ],
      seed
    );

    expect(ranked).toEqual([]);
  });

  it("sorts by score descending", () => {
    const ranked = rankCandidates(
      [
        candidate({ title: "Weaker", mbid: "weak", score: 0.1 }),
        candidate({ title: "Stronger", mbid: "strong", score: 0.9 }),
      ],
      seed
    );

    expect(ranked.map((r) => r.title)).toEqual(["Stronger", "Weaker"]);
  });
});
