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
      makeNode({ id: "a", flow: "spotlight" }),
      makeNode({ id: "b", flow: "spotlight", title: "One-hit discount" }),
      makeNode({ id: "outside", flow: "profile" }),
    ],
    [
      { id: "a->b", from: "a", to: "b", kind: "data" },
      { id: "outside->a", from: "outside", to: "a", kind: "data" },
    ]
  );

  it("renders every node through the custom node type", () => {
    const flow = buildFlow(graph, "spotlight");

    expect(flow.nodes).toHaveLength(3);
    expect(flow.nodes.every((node) => node.type === "recommenderNode")).toBe(
      true
    );
  });

  it("passes the node and its boundary status through as flow data", () => {
    const flow = buildFlow(graph, "spotlight");
    const outside = flow.nodes.find((node) => node.id === "outside");

    expect(flow.nodes[0].data.node.title).toBe("Rating boost");
    expect(outside?.data.external).toBe(true);
  });

  it("lays the flow out from its own edges", () => {
    const flow = buildFlow(graph, "spotlight");
    const [a, b] = ["a", "b"].map((id) =>
      flow.nodes.find((node) => node.id === id)!
    );

    expect(b.position.x).toBeGreaterThan(a.position.x);
  });

  it("attaches edges to the sides that face along the flow", () => {
    const across = buildFlow(graph, "spotlight", {
      direction: "LR",
      spacing: "comfortable",
    }).nodes[0];
    const down = buildFlow(graph, "spotlight", {
      direction: "TB",
      spacing: "comfortable",
    }).nodes[0];

    expect(across.sourcePosition).toBe("right");
    expect(across.targetPosition).toBe("left");
    expect(down.sourcePosition).toBe("bottom");
    expect(down.targetPosition).toBe("top");
  });

  it("tells each card which way the flow runs", () => {
    expect(
      buildFlow(graph, "spotlight", {
        direction: "TB",
        spacing: "compact",
      }).nodes[0].data.direction
    ).toBe("TB");
  });

  it("leaves out the flows it was not asked for", () => {
    expect(buildFlow(graph, "artists").nodes).toEqual([]);
  });
});
