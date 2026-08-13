import { describe, it, expect } from "vitest";
import { normalizeAlbumKey } from "./albumKey";

describe("normalizeAlbumKey", () => {
  it("is case, punctuation and whitespace insensitive", () => {
    expect(normalizeAlbumKey("Slowdive", "Souvlaki")).toBe(
      normalizeAlbumKey("  slowdive ", "Souvlaki!")
    );
  });

  it("folds diacritics", () => {
    expect(normalizeAlbumKey("Björk", "Vespertine")).toBe(
      normalizeAlbumKey("Bjork", "Vespertine")
    );
  });

  it("keeps different albums by the same artist apart", () => {
    expect(normalizeAlbumKey("Slowdive", "Souvlaki")).not.toBe(
      normalizeAlbumKey("Slowdive", "Pygmalion")
    );
  });

  it("keeps the same album by different artists apart", () => {
    expect(normalizeAlbumKey("Slowdive", "Souvlaki")).not.toBe(
      normalizeAlbumKey("Mojave 3", "Souvlaki")
    );
  });
});
