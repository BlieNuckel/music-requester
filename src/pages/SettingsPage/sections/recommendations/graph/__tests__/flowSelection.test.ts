import { selectFlow } from "../flowSelection";
import { makeGraph, makeNode } from "./fixtures";
import type { GraphEdge, RecommenderGraph } from "@shared/recommenderGraph";

const edges: GraphEdge[] = [
  {
    id: "profileDocument->pickLoop",
    from: "profileDocument",
    to: "pickLoop",
    kind: "data",
  },
  {
    id: "pickLoop->sourceChain",
    from: "pickLoop",
    to: "sourceChain",
    kind: "data",
  },
  {
    id: "sourceChain->carousel",
    from: "sourceChain",
    to: "carousel",
    kind: "data",
  },
  {
    id: "signalLog->profileDocument",
    from: "signalLog",
    to: "profileDocument",
    kind: "data",
  },
];

const graph: RecommenderGraph = makeGraph(
  [
    makeNode({ id: "signalLog", flow: "ingestion", params: [] }),
    makeNode({ id: "profileDocument", flow: "profile", params: [] }),
    makeNode({ id: "pickLoop", flow: "spotlight" }),
    makeNode({ id: "sourceChain", flow: "spotlight", params: [] }),
    makeNode({ id: "carousel", flow: "spotlight", params: [] }),
  ],
  edges
);

describe("selectFlow", () => {
  it("keeps the flow's own nodes", () => {
    const own = selectFlow(graph, "spotlight")
      .nodes.filter((entry) => !entry.external)
      .map((entry) => entry.node.id);

    expect(own).toEqual(["pickLoop", "sourceChain", "carousel"]);
  });

  it("brings in a directly connected node from another flow as a boundary", () => {
    const external = selectFlow(graph, "spotlight")
      .nodes.filter((entry) => entry.external)
      .map((entry) => entry.node.id);

    expect(external).toEqual(["profileDocument"]);
  });

  it("stops at one hop, so a chart does not redraw its neighbour", () => {
    const ids = selectFlow(graph, "spotlight").nodes.map(
      (entry) => entry.node.id
    );

    expect(ids).not.toContain("signalLog");
  });

  it("keeps every edge that touches the flow, in both directions", () => {
    const ids = selectFlow(graph, "profile").edges.map((edge) => edge.id);

    expect(ids).toEqual([
      "profileDocument->pickLoop",
      "signalLog->profileDocument",
    ]);
  });

  it("drops edges that touch neither side", () => {
    expect(selectFlow(graph, "artists")).toEqual({ nodes: [], edges: [] });
  });
});
