import { MarkerType } from "@xyflow/react";
import { layoutPositions, type LayoutMode } from "./autoLayout";
import type { Edge, Node } from "@xyflow/react";
import type {
  EdgeKind,
  GraphEdge,
  GraphNode,
  RecommenderGraph,
} from "@shared/recommenderGraph";

export type RecommenderNodeData = { node: GraphNode };
export type RecommenderFlowNode = Node<RecommenderNodeData>;

type EdgeStyle = { stroke: string; dash?: string };

const EDGE_STYLES: Record<EdgeKind, EdgeStyle> = {
  data: { stroke: "#6b7280" },
  fallback: { stroke: "#f59e0b", dash: "6 4" },
  control: { stroke: "#60a5fa", dash: "2 4" },
};

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th"];

/**
 * A fallback edge's label says where it sits in the order, because the order is the whole
 * meaning: these sources are tried one after another, and only until one answers.
 */
function fallbackLabel(edge: GraphEdge): string {
  const ordinal = ORDINALS[edge.order ?? 0] ?? `${(edge.order ?? 0) + 1}th`;
  return edge.label ? `${ordinal} choice, ${edge.label}` : `${ordinal} choice`;
}

function edgeLabel(edge: GraphEdge): string | undefined {
  if (edge.kind === "fallback") return fallbackLabel(edge);
  return edge.label;
}

export function toFlowEdges(edges: GraphEdge[]): Edge[] {
  return edges.map((edge) => {
    const style = EDGE_STYLES[edge.kind];
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      label: edgeLabel(edge),
      labelShowBg: true,
      markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
      style: {
        stroke: style.stroke,
        strokeWidth: 1.5,
        ...(style.dash ? { strokeDasharray: style.dash } : {}),
      },
      data: { kind: edge.kind },
    };
  });
}

export function toFlowNodes(
  graph: RecommenderGraph,
  mode: LayoutMode
): RecommenderFlowNode[] {
  const positions = layoutPositions(graph.nodes, graph.edges, mode);

  return graph.nodes.map((node) => ({
    id: node.id,
    type: "recommenderNode",
    position: positions.get(node.id) ?? node.position,
    data: { node },
  }));
}

/**
 * Node positions are dragged for a look at the layout, not saved: they belong to the
 * declared graph, and a per-user copy of them would be one more thing to keep in sync.
 */
export function buildFlow(
  graph: RecommenderGraph,
  mode: LayoutMode
): { nodes: RecommenderFlowNode[]; edges: Edge[] } {
  return { nodes: toFlowNodes(graph, mode), edges: toFlowEdges(graph.edges) };
}
