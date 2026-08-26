import { autoLayout, estimateNodeHeight, layoutBoxes } from "../autoLayout";
import { makeNode, ratingWeightParam } from "./fixtures";
import type { NodeBox } from "../autoLayout";
import type { FlowNode } from "@shared/recommenderGraph";
import type { GraphEdge } from "@shared/recommenderGraph";

const edge = (from: string, to: string): GraphEdge => ({
  id: `${from}->${to}`,
  from,
  to,
  kind: "data",
});

const own = (id: string): FlowNode => ({
  node: makeNode({ id }),
  external: false,
});

const nodes = [own("a"), own("b"), own("c")];

const overlaps = (a: NodeBox, b: NodeBox): boolean =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

const anyOverlap = (boxes: NodeBox[]): boolean =>
  boxes.some((box, i) =>
    boxes.slice(i + 1).some((other) => overlaps(box, other))
  );

describe("estimateNodeHeight", () => {
  it("grows with the number of knobs on the node", () => {
    const one = estimateNodeHeight(makeNode(), false);
    const two = estimateNodeHeight(
      makeNode({ params: [ratingWeightParam, ratingWeightParam] }),
      false
    );

    expect(two).toBeGreaterThan(one);
  });

  it("grows with a long summary, which wraps to more lines", () => {
    const short = estimateNodeHeight(makeNode({ summary: "Short." }), false);
    const long = estimateNodeHeight(
      makeNode({ summary: "Long. ".repeat(30) }),
      false
    );

    expect(long).toBeGreaterThan(short);
  });

  it("keeps a boundary reference small, since it shows no knobs", () => {
    expect(estimateNodeHeight(makeNode(), true)).toBeLessThan(
      estimateNodeHeight(makeNode(), false)
    );
  });
});

describe("autoLayout", () => {
  it("puts a node one lane past its deepest input", () => {
    const positions = autoLayout(nodes, [edge("a", "b"), edge("b", "c")]);

    expect(positions.get("a")!.x).toBe(0);
    expect(positions.get("b")!.x).toBeGreaterThan(positions.get("a")!.x);
    expect(positions.get("c")!.x).toBeGreaterThan(positions.get("b")!.x);
  });

  it("stacks nodes that share a lane", () => {
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

  it("never overlaps two cards, however tall they are", () => {
    const mixed: FlowNode[] = [
      {
        node: makeNode({ id: "tall", summary: "Long. ".repeat(40) }),
        external: false,
      },
      {
        node: makeNode({ id: "taller", summary: "Summary. ".repeat(20) }),
        external: false,
      },
      { node: makeNode({ id: "small" }), external: true },
      own("plain"),
    ];

    expect(anyOverlap(layoutBoxes(mixed, autoLayout(mixed, [])))).toBe(false);
  });

  it("never overlaps running downwards either", () => {
    const positions = autoLayout(nodes, [edge("a", "b")], {
      direction: "TB",
      spacing: "compact",
    });

    expect(anyOverlap(layoutBoxes(nodes, positions))).toBe(false);
  });

  it("runs the flow downwards when asked", () => {
    const positions = autoLayout(nodes, [edge("a", "b")], {
      direction: "TB",
      spacing: "comfortable",
    });

    expect(positions.get("b")!.y).toBeGreaterThan(positions.get("a")!.y);
    expect(positions.get("b")!.x).toBe(0);
  });

  it("spreads further apart at a roomier spacing", () => {
    const tight = autoLayout(nodes, [edge("a", "b")], {
      direction: "LR",
      spacing: "compact",
    });
    const loose = autoLayout(nodes, [edge("a", "b")], {
      direction: "LR",
      spacing: "roomy",
    });

    expect(loose.get("b")!.x).toBeGreaterThan(tight.get("b")!.x);
  });

  it("places a node beside what reads it, not beside what feeds it", () => {
    const chain = ["a", "b", "c", "d", "aside"].map(own);
    const positions = autoLayout(chain, [
      edge("a", "b"),
      edge("b", "c"),
      edge("c", "d"),
      edge("a", "aside"),
      edge("aside", "d"),
    ]);

    expect(positions.get("aside")!.x).toBe(positions.get("c")!.x);
  });

  it("orders a lane so its edges stop crossing each other", () => {
    const four = ["a", "b", "c", "d"].map(own);
    const positions = autoLayout(four, [edge("a", "d"), edge("b", "c")]);

    expect(positions.get("a")!.y).toBeLessThan(positions.get("b")!.y);
    expect(positions.get("d")!.y).toBeLessThan(positions.get("c")!.y);
  });

  it("fans a lane either side of what it came from, not only below it", () => {
    const hub = ["a", "b", "c", "d"].map(own);
    const positions = autoLayout(hub, [
      edge("a", "b"),
      edge("a", "c"),
      edge("a", "d"),
    ]);
    const fanned = ["b", "c", "d"].map((id) => positions.get(id)!.y);

    expect(Math.min(...fanned)).toBeLessThan(positions.get("a")!.y);
    expect(Math.max(...fanned)).toBeGreaterThan(positions.get("a")!.y);
  });

  it("centres a node on the middle of what it feeds", () => {
    const hub = ["a", "b", "c", "d"].map(own);
    const positions = autoLayout(hub, [
      edge("a", "b"),
      edge("a", "c"),
      edge("a", "d"),
    ]);
    const fanned = ["b", "c", "d"]
      .map((id) => positions.get(id)!.y)
      .sort((first, second) => first - second);

    expect(positions.get("a")!.y).toBe(fanned[1]);
  });

  it("lays out against what the browser measured, not what we guessed", () => {
    const measured = new Map([["a", { width: 300, height: 900 }]]);
    const guessed = autoLayout(nodes, [edge("a", "b")]);
    const settled = autoLayout(nodes, [edge("a", "b")], undefined, measured);

    expect(layoutBoxes(nodes, settled, measured)[0].height).toBe(900);
    expect(settled.get("b")!.y).not.toBe(guessed.get("b")!.y);
  });

  it("treats an unmeasured card as one that has not rendered yet", () => {
    const zeroed = new Map([["a", { width: 0, height: 0 }]]);
    const [box] = layoutBoxes(
      nodes,
      autoLayout(nodes, [], undefined, zeroed),
      zeroed
    );

    expect(box.height).toBe(estimateNodeHeight(makeNode(), false));
  });

  it("ignores edges to nodes outside this flow's selection", () => {
    const positions = autoLayout(nodes, [edge("elsewhere", "a")]);

    expect(positions.get("a")).toEqual({ x: 0, y: 0 });
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
