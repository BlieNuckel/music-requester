import type {
  FlowId,
  GraphEdge,
  GraphNode,
  RecommenderGraph,
} from "@shared/recommenderGraph";

/**
 * A node as one flow's chart shows it: its own, or a reference to a node that belongs to
 * another flow. The flows share nodes (every pick reads the profile), and a chart that
 * simply cut those edges would claim the recommendation comes from nowhere.
 */
export type FlowNode = { node: GraphNode; external: boolean };

export type FlowSelection = { nodes: FlowNode[]; edges: GraphEdge[] };

function isTouching(edge: GraphEdge, own: ReadonlySet<string>): boolean {
  return own.has(edge.from) || own.has(edge.to);
}

/**
 * The nodes of one flow, plus every node directly connected to them from another flow as a
 * boundary reference. Boundary nodes are one hop only: the point is to show where a flow
 * gets its inputs and where its output goes, not to redraw the neighbouring flow.
 */
export function selectFlow(
  graph: RecommenderGraph,
  flow: FlowId
): FlowSelection {
  const own = new Set(
    graph.nodes.filter((node) => node.flow === flow).map((node) => node.id)
  );
  const edges = graph.edges.filter((edge) => isTouching(edge, own));

  const referenced = new Set<string>();
  for (const edge of edges) {
    if (!own.has(edge.from)) referenced.add(edge.from);
    if (!own.has(edge.to)) referenced.add(edge.to);
  }

  const nodes = graph.nodes
    .filter((node) => own.has(node.id) || referenced.has(node.id))
    .map((node) => ({ node, external: !own.has(node.id) }));

  return { nodes, edges };
}

/** How many knobs a flow owns, for the flow switcher. */
export function countFlowParams(graph: RecommenderGraph, flow: FlowId): number {
  return graph.nodes
    .filter((node) => node.flow === flow)
    .reduce((total, node) => total + node.params.length, 0);
}
