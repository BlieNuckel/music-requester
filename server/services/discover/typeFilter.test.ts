import { describe, it, expect } from "vitest";
import { isAllowedReleaseType } from "./typeFilter";

describe("isAllowedReleaseType", () => {
  it("allows Album, EP, and Single primary types", () => {
    expect(isAllowedReleaseType("Album", [])).toBe(true);
    expect(isAllowedReleaseType("EP", [])).toBe(true);
    expect(isAllowedReleaseType("Single", [])).toBe(true);
  });

  it("blocks other known primary types", () => {
    expect(isAllowedReleaseType("Broadcast", [])).toBe(false);
    expect(isAllowedReleaseType("Other", [])).toBe(false);
  });

  it("passes unknown types through", () => {
    expect(isAllowedReleaseType(null, null)).toBe(true);
    expect(isAllowedReleaseType("Album", null)).toBe(true);
  });

  it("blocks noisy secondary types", () => {
    expect(isAllowedReleaseType("Album", ["Live"])).toBe(false);
    expect(isAllowedReleaseType("Album", ["Remix"])).toBe(false);
    expect(isAllowedReleaseType("Album", ["Compilation"])).toBe(false);
    expect(isAllowedReleaseType("Album", ["DJ-mix"])).toBe(false);
    expect(isAllowedReleaseType("Single", ["Demo"])).toBe(false);
  });

  it("allows Soundtrack and Mixtape/Street secondary types", () => {
    expect(isAllowedReleaseType("Album", ["Soundtrack"])).toBe(true);
    expect(isAllowedReleaseType("Album", ["Mixtape/Street"])).toBe(true);
  });

  it("blocks when any secondary type is disallowed", () => {
    expect(isAllowedReleaseType("Album", ["Soundtrack", "Live"])).toBe(false);
  });
});
