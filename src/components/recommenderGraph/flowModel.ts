import { MarkerType, Position } from "@xyflow/react";
import { autoLayout } from "./autoLayout";
import type {
  LayoutDirection,
  LayoutOptions,
  MeasuredSizes,
  Position as CardPosition,
} from "./autoLayout";
import { selectFlow } from "@shared/recommenderGraph";
import type { Edge, Node } from "@xyflow/react";
import type {
  EdgeKind,
  FlowId,
  GraphEdge,
  GraphNode,
  RecommenderGraph,
} from "@shared/recommenderGraph";
import type { NodeRun, RecommendationTrace } from "@shared/recommendationTrace";

export type RecommenderNodeData = {
  node: GraphNode;
  external: boolean;
  /** Which way this flow runs, so a card attaches its edges on the facing sides. */
  direction: LayoutDirection;
  /** What this node did, when the chart is explaining one recommendation. */
  run?: NodeRun;
  /**
   * True when a run is being shown and this node had no part in it. A source that was never
   * asked is a different story from one that answered and came up empty, and only drawing
   * the difference makes "it was an explore pick, so the rest never ran" readable.
   */
  skipped?: boolean;
  /** The node whose output became the recommendation. */
  source?: boolean;
};
export type RecommenderFlowNode = Node<RecommenderNodeData>;

type EdgeStyle = { stroke: string; dash?: string };

const EDGE_STYLES: Record<EdgeKind, EdgeStyle> = {
  data: { stroke: "#6b7280" },
  fallback: { stroke: "#f59e0b", dash: "6 4" },
  control: { stroke: "#60a5fa", dash: "2 4" },
};

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th"];

/** Where a card's edges leave and arrive, following the direction the flow is laid out in. */
export const HANDLE_SIDES: Record<
  LayoutDirection,
  { source: Position; target: Position }
> = {
  LR: { source: Position.Right, target: Position.Left },
  TB: { source: Position.Bottom, target: Position.Top },
};

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

/**
 * Curved, not orthogonal. Right angles were tried and read worse here: every card has one
 * centred source handle, so edges leaving the same node start at the same point and their
 * straight segments coincide exactly into one thick line, where curves at least fan apart.
 * The library's right-angled route also turns at the midpoint between the two cards, which
 * for a two-lane span is inside the lane between them — where a card is.
 *
 * Orthogonal only pays off once each edge carries its own waypoints through the corridors
 * the layout reserves for it, which is a custom edge rather than a `type` string.
 */
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
export function layoutPositions(
  graph: RecommenderGraph,
  flow: FlowId,
  layout: LayoutOptions | undefined,
  measured: MeasuredSizes
): Map<string, CardPosition> {
  const selection = selectFlow(graph, flow);
  return autoLayout(selection.nodes, selection.edges, layout, measured);
}

/**
 * What one run says about a node, when a run is being shown at all. A node the run never
 * reached is marked rather than dropped: the chart is the shape of the pipeline first, and
 * the path through it second.
 */
function runFor(
  nodeId: string,
  trace: RecommendationTrace | undefined
): Pick<RecommenderNodeData, "run" | "skipped" | "source"> {
  if (!trace) return {};
  const run = trace.nodes.find((entry) => entry.nodeId === nodeId);
  return {
    ...(run ? { run } : {}),
    skipped: !run,
    source: trace.source === nodeId,
  };
}

export function buildFlow(
  graph: RecommenderGraph,
  flow: FlowId,
  layout?: LayoutOptions,
  trace?: RecommendationTrace
): { nodes: RecommenderFlowNode[]; edges: Edge[] } {
  const selection = selectFlow(graph, flow);
  const positions = autoLayout(selection.nodes, selection.edges, layout);
  const direction = layout?.direction ?? "LR";
  const sides = HANDLE_SIDES[direction];

  return {
    nodes: selection.nodes.map((entry) => ({
      id: entry.node.id,
      type: "recommenderNode",
      position: positions.get(entry.node.id) ?? { x: 0, y: 0 },
      sourcePosition: sides.source,
      targetPosition: sides.target,
      data: { ...entry, direction, ...runFor(entry.node.id, trace) },
    })),
    edges: toFlowEdges(selection.edges),
  };
}
