import { MarkerType } from "@xyflow/react";
import { autoLayout } from "./autoLayout";
import type { LayoutOptions } from "./autoLayout";
import { selectFlow } from "./flowSelection";
import type { Edge, Node } from "@xyflow/react";
import type {
  EdgeKind,
  FlowId,
  GraphEdge,
  GraphNode,
  RecommenderGraph,
} from "@shared/recommenderGraph";

export type RecommenderNodeData = { node: GraphNode; external: boolean };
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

/**
 * One flow as a canvas. Positions are computed per flow rather than globally, so a chart is
 * laid out against its own depth instead of against the longest chain in the whole app.
 *
 * Node positions can be dragged for a look, but are not saved: they belong to the declared
 * graph, and a per-user copy of them would be one more thing to keep in sync.
 */
export function buildFlow(
  graph: RecommenderGraph,
  flow: FlowId,
  layout?: LayoutOptions
): { nodes: RecommenderFlowNode[]; edges: Edge[] } {
  const selection = selectFlow(graph, flow);
  const positions = autoLayout(selection.nodes, selection.edges, layout);

  return {
    nodes: selection.nodes.map((entry) => ({
      id: entry.node.id,
      type: "recommenderNode",
      position: positions.get(entry.node.id) ?? { x: 0, y: 0 },
      data: entry,
    })),
    edges: toFlowEdges(selection.edges),
  };
}
