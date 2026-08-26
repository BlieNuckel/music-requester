import { describe, it, expect } from "vitest";
import {
  cappedItems,
  TRACE_ITEM_LIMIT,
} from "../../shared/recommendationTrace";

const items = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ name: `Artist ${i}` }));

describe("cappedItems", () => {
  it("lists a short set whole and counts nothing", () => {
    const fact = cappedItems("Neighbours", items(3));

    expect(fact.items).toHaveLength(3);
    expect(fact.more).toBeUndefined();
  });

  /**
   * Five picks each carrying a hundred-odd neighbours is a carousel response measured in
   * hundreds of kilobytes, so the tail is counted rather than shipped.
   */
  it("counts the tail it left out rather than dropping it silently", () => {
    const fact = cappedItems("Neighbours", items(TRACE_ITEM_LIMIT + 8));

    expect(fact.items).toHaveLength(TRACE_ITEM_LIMIT);
    expect(fact.more).toBe(8);
  });

  it("keeps the one that was chosen, wherever it sat in the list", () => {
    const long = [...items(40), { name: "The pick", chosen: true }];
    const fact = cappedItems("Neighbours", long);

    expect(fact.items?.[0]).toEqual({ name: "The pick", chosen: true });
    expect(fact.items).toHaveLength(TRACE_ITEM_LIMIT + 1);
  });
});
