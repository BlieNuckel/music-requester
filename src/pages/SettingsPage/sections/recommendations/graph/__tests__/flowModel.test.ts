import { buildFlow, toFlowEdges } from "../flowModel";
import { makeGraph, makeNode } from "./fixtures";
import type { GraphEdge } from "@shared/recommenderGraph";

const edges: GraphEdge[] = [
  { id: "a->b", from: "a", to: "b", kind: "data", label: "window" },
  { id: "c->b", from: "c", to: "b", kind: "fallback", order: 1 },
  { id: "a->c", from: "a", to: "c", kind: "control" },
];

describe("toFlowEdges", () => {
  it("labels a fallback edge with where it sits in the order", () => {
    const [, fallback] = toFlowEdges(edges);

    expect(fallback.label).toBe("2nd choice");
  });

  it("keeps a data edge's own label", () => {
    expect(toFlowEdges(edges)[0].label).toBe("window");
  });

  it("dashes fallback and control edges but not data ones", () => {
    const [data, fallback, control] = toFlowEdges(edges);

    expect(data.style).not.toHaveProperty("strokeDasharray");
    expect(fallback.style).toHaveProperty("strokeDasharray");
    expect(control.style).toHaveProperty("strokeDasharray");
  });

  it("carries the kind through for anything that needs to style by it", () => {
    expect(toFlowEdges(edges).map((edge) => edge.data?.kind)).toEqual([
      "data",
      "fallback",
      "control",
    ]);
  });
});

describe("buildFlow", () => {
  const graph = makeGraph(
    [
      makeNode({ id: "a", position: { x: 5, y: 6 } }),
      makeNode({ id: "b", position: { x: 7, y: 8 } }),
    ],
    [{ id: "a->b", from: "a", to: "b", kind: "data" }]
  );

  it("renders every node through the custom node type", () => {
    const flow = buildFlow(graph, "authored");

    expect(flow.nodes).toHaveLength(2);
    expect(flow.nodes.every((node) => node.type === "recommenderNode")).toBe(
      true
    );
  });

  it("passes the node itself through as flow data", () => {
    const flow = buildFlow(graph, "authored");

    expect(flow.nodes[0].data.node.title).toBe("Rating boost");
  });

  it("honours the authored positions, and replaces them in auto mode", () => {
    expect(buildFlow(graph, "authored").nodes[0].position).toEqual({
      x: 5,
      y: 6,
    });
    expect(buildFlow(graph, "auto").nodes[0].position).toEqual({ x: 0, y: 0 });
  });
});
