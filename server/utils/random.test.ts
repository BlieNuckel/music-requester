import { describe, it, expect, vi, beforeEach } from "vitest";
import { weightedRandomPick, shuffle } from "./random";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("weightedRandomPick", () => {
  it("returns requested number of items", () => {
    const items = [
      { name: "a", w: 10 },
      { name: "b", w: 20 },
      { name: "c", w: 30 },
    ];
    const result = weightedRandomPick(items, (i) => i.w, 2);
    expect(result).toHaveLength(2);
  });

  it("returns all items when count >= length", () => {
    const items = [
      { name: "a", w: 1 },
      { name: "b", w: 1 },
    ];
    const result = weightedRandomPick(items, (i) => i.w, 5);
    expect(result).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    const result = weightedRandomPick([], () => 1, 3);
    expect(result).toEqual([]);
  });

  it("picks without replacement", () => {
    const items = [{ name: "a" }, { name: "b" }, { name: "c" }];
    const result = weightedRandomPick(items, () => 1, 3);
    const names = result.map((r) => r.name);
    expect(new Set(names).size).toBe(3);
  });

  it("returns single item from single-element array", () => {
    const items = [{ name: "only" }];
    const result = weightedRandomPick(items, () => 1, 1);
    expect(result).toEqual([{ name: "only" }]);
  });

  it("picks uniformly when every weight is zero", () => {
    const items = [{ name: "a" }, { name: "b" }, { name: "c" }];
    const picked = new Set<string>();
    for (let i = 0; i < 200; i++) {
      picked.add(weightedRandomPick(items, () => 0, 1)[0].name);
    }
    expect(picked).toEqual(new Set(["a", "b", "c"]));
  });

  it("still picks without replacement at zero total weight", () => {
    const items = [{ name: "a" }, { name: "b" }, { name: "c" }];
    const result = weightedRandomPick(items, () => 0, 3);
    expect(new Set(result.map((r) => r.name)).size).toBe(3);
  });

  it("never overruns the pool when the rng returns 1", () => {
    const items = [{ name: "a" }, { name: "b" }];
    const result = weightedRandomPick(
      items,
      () => 0,
      1,
      () => 1
    );
    expect(result).toEqual([{ name: "b" }]);
  });

  it("respects weights over many iterations", () => {
    const items = [
      { name: "heavy", w: 100 },
      { name: "light", w: 1 },
    ];
    let heavyFirst = 0;
    const iterations = 200;
    for (let i = 0; i < iterations; i++) {
      const result = weightedRandomPick(items, (item) => item.w, 1);
      if (result[0].name === "heavy") heavyFirst++;
    }
    expect(heavyFirst).toBeGreaterThan(iterations * 0.7);
  });
});

describe("shuffle", () => {
  it("returns array of same length", () => {
    const arr = [1, 2, 3, 4, 5];
    const result = shuffle(arr);
    expect(result).toHaveLength(5);
  });

  it("contains same elements", () => {
    const arr = [1, 2, 3, 4, 5];
    const result = shuffle(arr);
    expect(result.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("does not mutate original array", () => {
    const arr = [1, 2, 3];
    const original = [...arr];
    shuffle(arr);
    expect(arr).toEqual(original);
  });

  it("returns empty array for empty input", () => {
    expect(shuffle([])).toEqual([]);
  });

  it("returns single-element array unchanged", () => {
    expect(shuffle([42])).toEqual([42]);
  });

  it("produces different orders over many attempts", () => {
    const arr = [1, 2, 3, 4, 5];
    const results = new Set<string>();
    for (let i = 0; i < 50; i++) {
      results.add(JSON.stringify(shuffle(arr)));
    }
    expect(results.size).toBeGreaterThan(1);
  });
});
