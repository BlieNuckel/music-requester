import { describe, it, expect } from "vitest";
import {
  preferenceRule,
  preferenceNote,
  orderByPreference,
} from "./preference";

const inLibrary = (mbid: string) => mbid === "owned";

describe("preferenceRule", () => {
  it("prefers artists outside the library under prefer_new", () => {
    const rule = preferenceRule("prefer_new", inLibrary);
    expect(rule.isPreferred("new")).toBe(true);
    expect(rule.isPreferred("owned")).toBe(false);
    expect(preferenceNote(rule, "new")).toMatch(/new discovery/i);
    expect(preferenceNote(rule, "owned")).toMatch(/already in your library/i);
  });

  it("prefers artists in the library under prefer_library", () => {
    const rule = preferenceRule("prefer_library", inLibrary);
    expect(rule.isPreferred("owned")).toBe(true);
    expect(rule.isPreferred("new")).toBe(false);
    expect(preferenceNote(rule, "owned")).toMatch(/already in your library/i);
    expect(preferenceNote(rule, "new")).toMatch(/new to your library/i);
  });

  it("treats everything as preferred under no_preference", () => {
    const rule = preferenceRule("no_preference", inLibrary);
    expect(rule.isPreferred("owned")).toBe(true);
    expect(rule.isPreferred("new")).toBe(true);
    expect(preferenceNote(rule, "owned")).toMatch(/no library preference/i);
  });
});

describe("orderByPreference", () => {
  it("puts preferred items first without dropping the rest", () => {
    const items = [{ mbid: "owned" }, { mbid: "new" }, { mbid: "other" }];
    const ordered = orderByPreference(
      items,
      (i) => i.mbid,
      preferenceRule("prefer_new", inLibrary)
    );
    expect(ordered.map((i) => i.mbid)).toEqual(["new", "other", "owned"]);
  });

  it("keeps the original order when nothing is preferred over anything", () => {
    const items = [{ mbid: "a" }, { mbid: "b" }];
    const ordered = orderByPreference(
      items,
      (i) => i.mbid,
      preferenceRule("no_preference", inLibrary)
    );
    expect(ordered.map((i) => i.mbid)).toEqual(["a", "b"]);
  });
});
