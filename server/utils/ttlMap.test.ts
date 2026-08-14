import { describe, it, expect } from "vitest";
import { createTtlMap } from "./ttlMap";

describe("createTtlMap", () => {
  it("returns a value inside its ttl", () => {
    const map = createTtlMap<string, number>();
    map.set("a", 1, 1000, 0);

    expect(map.get("a", 999)).toBe(1);
  });

  it("treats an entry as gone once the ttl elapses", () => {
    const map = createTtlMap<string, number>();
    map.set("a", 1, 1000, 0);

    expect(map.get("a", 1000)).toBeUndefined();
  });

  it("drops an expired entry on read rather than leaving it resident", () => {
    const map = createTtlMap<string, number>();
    map.set("a", 1, 1000, 0);

    map.get("a", 1000);

    expect(map.size()).toBe(0);
  });

  it("sweeps entries that expired but were never read again", () => {
    const map = createTtlMap<string, number>();
    map.set("stale", 1, 1000, 0);
    map.set("alsoStale", 2, 1000, 0);

    map.set("fresh", 3, 1000, 5000);

    expect(map.size()).toBe(1);
    expect(map.get("fresh", 5000)).toBe(3);
  });

  it("keeps unexpired entries when sweeping", () => {
    const map = createTtlMap<string, number>();
    map.set("longLived", 1, 10_000, 0);
    map.set("shortLived", 2, 100, 0);

    map.set("new", 3, 1000, 500);

    expect(map.size()).toBe(2);
    expect(map.get("longLived", 500)).toBe(1);
    expect(map.get("shortLived", 500)).toBeUndefined();
  });

  it("overwrites an existing key with a fresh expiry", () => {
    const map = createTtlMap<string, number>();
    map.set("a", 1, 1000, 0);
    map.set("a", 2, 1000, 900);

    expect(map.get("a", 1500)).toBe(2);
  });

  it("clears everything", () => {
    const map = createTtlMap<string, number>();
    map.set("a", 1, 1000, 0);
    map.set("b", 2, 1000, 0);

    map.clear();

    expect(map.size()).toBe(0);
  });

  it("reports when a live entry expires", () => {
    const map = createTtlMap<string, number>();
    map.set("a", 1, 1000, 0);

    expect(map.expiresAt("a", 500)).toBe(1000);
  });

  it("reports no expiry for an absent or expired key", () => {
    const map = createTtlMap<string, number>();
    map.set("a", 1, 1000, 0);

    expect(map.expiresAt("a", 1000)).toBeUndefined();
    expect(map.expiresAt("missing", 0)).toBeUndefined();
  });

  it("lists only the keys still live", () => {
    const map = createTtlMap<string, number>();
    map.set("short", 1, 1000, 0);
    map.set("long", 2, 5000, 0);

    expect(map.keys(2000)).toEqual(["long"]);
  });
});
