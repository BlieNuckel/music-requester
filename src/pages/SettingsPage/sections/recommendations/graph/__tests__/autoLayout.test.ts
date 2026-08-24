import { autoLayout, layoutPositions } from "../autoLayout";
import { makeNode } from "./fixtures";
import type { GraphEdge } from "@shared/recommenderGraph";

const edge = (from: string, to: string): GraphEdge => ({
  id: `${from}->${to}`,
  from,
  to,
  kind: "data",
});

const nodes = [
  makeNode({ id: "a", position: { x: 900, y: 900 } }),
  makeNode({ id: "b", position: { x: 10, y: 20 } }),
  makeNode({ id: "c", position: { x: 0, y: 0 } }),
];

describe("autoLayout", () => {
  it("puts a node one column past its deepest input", () => {
    const positions = autoLayout(nodes, [edge("a", "b"), edge("b", "c")]);

    expect(positions.get("a")!.x).toBe(0);
    expect(positions.get("b")!.x).toBeGreaterThan(positions.get("a")!.x);
    expect(positions.get("c")!.x).toBeGreaterThan(positions.get("b")!.x);
  });

  it("stacks nodes that share a depth", () => {
    const positions = autoLayout(nodes, [edge("a", "b"), edge("a", "c")]);

    expect(positions.get("b")!.x).toBe(positions.get("c")!.x);
    expect(positions.get("b")!.y).not.toBe(positions.get("c")!.y);
  });

  it("measures depth from the longest path, not the first one found", () => {
    const positions = autoLayout(nodes, [
      edge("a", "b"),
      edge("a", "c"),
      edge("b", "c"),
    ]);

    expect(positions.get("c")!.x).toBeGreaterThan(positions.get("b")!.x);
  });

  it("terminates on a cycle rather than recursing forever", () => {
    const positions = autoLayout(nodes, [
      edge("a", "b"),
      edge("b", "c"),
      edge("c", "a"),
    ]);

    expect(positions.size).toBe(3);
  });
});

describe("layoutPositions", () => {
  it("uses the authored positions as declared", () => {
    const positions = layoutPositions(nodes, [], "authored");

    expect(positions.get("a")).toEqual({ x: 900, y: 900 });
    expect(positions.get("b")).toEqual({ x: 10, y: 20 });
  });

  it("ignores them entirely in auto mode", () => {
    const positions = layoutPositions(nodes, [edge("a", "b")], "auto");

    expect(positions.get("a")).toEqual({ x: 0, y: 0 });
  });
});
