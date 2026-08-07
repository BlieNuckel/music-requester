import { describe, it, expect } from "vitest";
import {
  isPlaceholderArtist,
  hasPlaceholderArtist,
  VARIOUS_ARTISTS_MBID,
  UNKNOWN_ARTIST_MBID,
  NO_ARTIST_MBID,
} from "./artistFilter";

describe("isPlaceholderArtist", () => {
  it("matches the special-purpose MBIDs regardless of name", () => {
    expect(isPlaceholderArtist("Anything", VARIOUS_ARTISTS_MBID)).toBe(true);
    expect(isPlaceholderArtist("Anything", UNKNOWN_ARTIST_MBID)).toBe(true);
    expect(isPlaceholderArtist("Anything", NO_ARTIST_MBID)).toBe(true);
    expect(isPlaceholderArtist(null, VARIOUS_ARTISTS_MBID.toUpperCase())).toBe(
      true
    );
  });

  it("matches placeholder names case- and whitespace-insensitively", () => {
    expect(isPlaceholderArtist("Various Artists")).toBe(true);
    expect(isPlaceholderArtist("  various artists  ")).toBe(true);
    expect(isPlaceholderArtist("VARIOUS")).toBe(true);
    expect(isPlaceholderArtist("V.A.")).toBe(true);
    expect(isPlaceholderArtist("[unknown]")).toBe(true);
    expect(isPlaceholderArtist("Unknown Artist")).toBe(true);
    expect(isPlaceholderArtist("[no artist]")).toBe(true);
  });

  it("leaves real artists alone", () => {
    expect(isPlaceholderArtist("Various Production")).toBe(false);
    expect(isPlaceholderArtist("VA", "mbid-va")).toBe(false);
    expect(isPlaceholderArtist("Radiohead", "mbid-radiohead")).toBe(false);
    expect(isPlaceholderArtist(null)).toBe(false);
    expect(isPlaceholderArtist(undefined, null)).toBe(false);
    expect(isPlaceholderArtist("")).toBe(false);
  });
});

describe("hasPlaceholderArtist", () => {
  it("is true when any credited MBID is a placeholder", () => {
    expect(hasPlaceholderArtist(["mbid-a", VARIOUS_ARTISTS_MBID])).toBe(true);
  });

  it("is false for an all-real credit list", () => {
    expect(hasPlaceholderArtist(["mbid-a", "mbid-b"])).toBe(false);
    expect(hasPlaceholderArtist([])).toBe(false);
  });
});
