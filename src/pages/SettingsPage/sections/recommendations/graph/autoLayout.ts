import { graphlib, layout } from "@dagrejs/dagre";
import type { FlowNode } from "./flowSelection";
import type { GraphEdge, GraphNode } from "@shared/recommenderGraph";

export type Position = { x: number; y: number };

export type LayoutDirection = "LR" | "TB";

export type Spacing = "compact" | "comfortable" | "roomy";

export type LayoutOptions = { direction: LayoutDirection; spacing: Spacing };

export type NodeBox = Position & { width: number; height: number };

/** Card widths, matching the two node components. */
export const NODE_WIDTH = 300;
export const EXTERNAL_WIDTH = 220;

const GAPS: Record<Spacing, number> = {
  compact: 40,
  comfortable: 90,
  roomy: 160,
};

const CHARS_PER_LINE = 40;
const LINE_HEIGHT = 16;
const CARD_CHROME = 78;
const EXTERNAL_HEIGHT = 104;
const INPUT_ROW = 38;
const DISCLOSURE = 22;
const CHIP_ROW = 24;

/** Room between two edges sharing a rank, so a label has somewhere to sit. */
const EDGE_SEPARATION = 24;

const lines = (text: string): number =>
  Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));

const wrapped = (text: string): number => lines(text) * LINE_HEIGHT;

/**
 * How tall a node's card will be, estimated from its content rather than measured.
 *
 * Deliberately an over-estimate: the layout runs before anything is rendered, and a node
 * placed too far apart is untidy while one placed too close overlaps its neighbour and hides
 * the knob inside it.
 */
export function estimateNodeHeight(node: GraphNode, external: boolean): number {
  if (external) return EXTERNAL_HEIGHT;

  let height = CARD_CHROME + wrapped(node.title) + wrapped(node.summary);
  if (node.note) height += wrapped(node.note) + 8;

  for (const param of node.params) {
    height += param.formula
      ? wrapped(param.formula) + INPUT_ROW
      : INPUT_ROW + LINE_HEIGHT;
  }
  if (node.params.length > 0) height += DISCLOSURE;
  if (node.usesParams.length > 0) {
    height += Math.ceil(node.usesParams.length / 2) * CHIP_ROW;
  }
  return height;
}

const nodeWidth = (entry: FlowNode): number =>
  entry.external ? EXTERNAL_WIDTH : NODE_WIDTH;

/**
 * Layered layout, delegated to dagre.
 *
 * This was hand-rolled first, through four rounds of the same lesson: ranks, then ordering so
 * edges stop crossing, then corridors for an edge crossing a rank it does not stop in, then
 * placement that could move a card up rather than only down. Every round was a step towards
 * something dagre already does — ranks by network simplex, ordering by barycentre sweeps,
 * dummy nodes for long edges, coordinates by Brandes-Köpf — and each one was a fresh chance
 * for the chart to be subtly wrong in a way nobody notices without staring at it.
 *
 * What stays ours is the part dagre cannot know: how tall a card will be before it renders.
 * The library places boxes; only we can say how big the box is going to be.
 */
export function autoLayout(
  nodes: FlowNode[],
  edges: GraphEdge[],
  options: LayoutOptions = { direction: "LR", spacing: "comfortable" }
): Map<string, Position> {
  const gap = GAPS[options.spacing];
  const known = new Set(nodes.map((entry) => entry.node.id));

  const graph = new graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: options.direction,
    nodesep: gap,
    ranksep: gap * 2,
    edgesep: EDGE_SEPARATION,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const entry of nodes) {
    graph.setNode(entry.node.id, {
      width: nodeWidth(entry),
      height: estimateNodeHeight(entry.node, entry.external),
    });
  }
  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    // Named, because two edges can share a pair — a node reading one field of the profile and
    // falling back to another. An unnamed second edge would replace the first.
    graph.setEdge(edge.from, edge.to, {}, edge.id);
  }

  layout(graph);

  const positions = new Map<string, Position>();
  for (const entry of nodes) {
    const placed = graph.node(entry.node.id);
    if (!placed) continue;
    positions.set(entry.node.id, {
      x: placed.x - placed.width / 2,
      y: placed.y - placed.height / 2,
    });
  }
  return positions;
}

/** The laid-out boxes, for asserting that nothing lands on top of anything else. */
export function layoutBoxes(
  nodes: FlowNode[],
  positions: Map<string, Position>
): NodeBox[] {
  return nodes.map((entry) => ({
    ...(positions.get(entry.node.id) ?? { x: 0, y: 0 }),
    width: nodeWidth(entry),
    height: estimateNodeHeight(entry.node, entry.external),
  }));
}
