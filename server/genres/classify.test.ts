import { describe, it, expect } from "vitest";
import {
  VOCABULARY_VERSION,
  classifyTag,
  foldTag,
  isGenreTag,
} from "./classify";

describe("foldTag", () => {
  it("collapses case, separators and ampersands to one key", () => {
    const key = foldTag("hip hop");
    for (const spelling of ["Hip-Hop", "HIP HOP", "hip_hop", "hip  hop"]) {
      expect(foldTag(spelling)).toBe(key);
    }
    expect(foldTag("R&B")).toBe(foldTag("R and B"));
  });

  it("is empty for a tag with nothing to key on", () => {
    expect(foldTag("   ")).toBe("");
    expect(foldTag("!!!")).toBe("");
  });

  it("does not stem, so a sub-genre keeps its own identity", () => {
    expect(foldTag("post-rock")).not.toBe(foldTag("rock"));
    expect(foldTag("nu-disco")).not.toBe(foldTag("disco"));
  });
});

describe("classifyTag", () => {
  it("recognizes a MusicBrainz genre and returns its canonical spelling", () => {
    expect(classifyTag("Drum and bass")).toMatchObject({
      class: "genre",
      canonical: "drum and bass",
    });
  });

  it("resolves an abbreviation to the genre it abbreviates", () => {
    expect(classifyTag("DnB")).toMatchObject({
      class: "genre",
      canonical: "drum and bass",
    });
  });

  it("gives two spellings of one genre the same canonical name", () => {
    const a = classifyTag("Hip-Hop").canonical;
    const b = classifyTag("hip hop").canonical;
    const c = classifyTag("rap").canonical;
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("recognizes a demonym as its country", () => {
    expect(classifyTag("belgian")).toMatchObject({
      class: "region",
      canonical: "Belgium",
    });
    expect(classifyTag("Belgium").canonical).toBe("Belgium");
  });

  it("classifies a tag carrying a year as era", () => {
    expect(classifyTag("2024").class).toBe("era");
    expect(classifyTag("best of 2011").class).toBe("era");
  });

  it("leaves a tag no vocabulary claims as unknown", () => {
    for (const junk of ["rutracker", "title is declarative", "bombastic"]) {
      expect(classifyTag(junk).class).toBe("unknown");
    }
  });

  it("keeps the tag as it arrived, whatever it resolved to", () => {
    expect(classifyTag("DnB").name).toBe("DnB");
  });

  it("treats an empty tag as unknown rather than throwing", () => {
    expect(classifyTag("   ")).toEqual({
      name: "   ",
      canonical: "",
      class: "unknown",
    });
  });

  it("does not merge a sub-genre into its parent", () => {
    expect(classifyTag("post-rock").canonical).not.toBe(
      classifyTag("rock").canonical
    );
    expect(classifyTag("folk punk").canonical).not.toBe(
      classifyTag("folk").canonical
    );
  });

  it("prefers genre over region when a word could be either", () => {
    // The artifact excludes any region name MusicBrainz also lists as a genre, so the
    // classifier can never be asked to choose — this pins that invariant from the outside.
    for (const name of ["cumbia", "salsa", "highlife", "reggae"]) {
      expect(classifyTag(name).class).toBe("genre");
    }
  });
});

describe("isGenreTag", () => {
  it("accepts only the genre class", () => {
    expect(isGenreTag("shoegaze")).toBe(true);
    expect(isGenreTag("DnB")).toBe(true);
    expect(isGenreTag("nigerian")).toBe(false);
    expect(isGenreTag("2024")).toBe(false);
    expect(isGenreTag("rutracker")).toBe(false);
  });
});

describe("VOCABULARY_VERSION", () => {
  it("is a date stamp, so a regenerated artifact changes the profile config hash", () => {
    expect(VOCABULARY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
