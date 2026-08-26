import { graphlib, layout } from "@dagrejs/dagre";
import { BAR_KINDS } from "./paramKinds";
import type { FlowNode } from "./flowSelection";
import type { GraphEdge, GraphNode, ParamDef } from "@shared/recommenderGraph";

export type Position = { x: number; y: number };

export type LayoutDirection = "LR" | "TB";

export type Spacing = "compact" | "comfortable" | "roomy";

export type LayoutOptions = { direction: LayoutDirection; spacing: Spacing };

/**
 * How every chart is drawn. Both were switchable in the toolbar while it was an open question
 * how these should read; they are not any more, and a control nobody needs to touch is one
 * more thing between a reader and the graph.
 */
export const DEFAULT_LAYOUT: LayoutOptions = {
  direction: "LR",
  spacing: "roomy",
};

export type NodeBox = Position & { width: number; height: number };

/** What the browser reports a card actually is, once it has rendered. */
export type MeasuredSizes = Map<string, { width: number; height: number }>;

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
/** The "also on <step>" line under a knob owned by another step. */
const OWNER_ROW = 16;

/** Room between two edges sharing a rank, so a label has somewhere to sit. */
const EDGE_SEPARATION = 24;

const lines = (text: string): number =>
  Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));

const wrapped = (text: string): number => lines(text) * LINE_HEIGHT;

const paramHeight = (param: ParamDef): number =>
  BAR_KINDS.has(param.kind)
    ? LINE_HEIGHT + INPUT_ROW + wrapped(param.effect ?? "")
    : param.effect
      ? wrapped(param.effect) + INPUT_ROW
      : INPUT_ROW + LINE_HEIGHT;

/**
 * How tall a node's card will be, guessed from its content.
 *
 * Only ever a first guess, for the pass that runs before anything has rendered. It cannot be
 * right: a tag editor's height depends on how many tags the user has and how they wrap, and
 * the graph deliberately carries no values for the estimate to read. The layout is run again
 * against the real heights as soon as the cards exist.
 */
export function estimateNodeHeight(node: GraphNode, external: boolean): number {
  if (external) return EXTERNAL_HEIGHT;

  let height = CARD_CHROME + wrapped(node.title) + wrapped(node.summary);
  if (node.note) height += wrapped(node.note) + 8;

  for (const param of node.params) height += paramHeight(param);
  if (node.usesParams.length > 0) {
    height += LINE_HEIGHT + OWNER_ROW * node.usesParams.length;
    for (const param of node.usesParams) height += paramHeight(param);
  }
  return height;
}

const nodeWidth = (entry: FlowNode): number =>
  entry.external ? EXTERNAL_WIDTH : NODE_WIDTH;

/**
 * A card's size: what the browser measured where it has, and the guess elsewhere. A measured
 * zero is not a measurement — it is a card that has not been laid out yet — so it falls back
 * rather than collapsing the node to nothing.
 */
function sizeOf(
  entry: FlowNode,
  measured?: MeasuredSizes
): { width: number; height: number } {
  const real = measured?.get(entry.node.id);
  return {
    width: real?.width || nodeWidth(entry),
    height: real?.height || estimateNodeHeight(entry.node, entry.external),
  };
}

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
  options: LayoutOptions = DEFAULT_LAYOUT,
  measured?: MeasuredSizes
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
    graph.setNode(entry.node.id, sizeOf(entry, measured));
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
  positions: Map<string, Position>,
  measured?: MeasuredSizes
): NodeBox[] {
  return nodes.map((entry) => ({
    ...(positions.get(entry.node.id) ?? { x: 0, y: 0 }),
    ...sizeOf(entry, measured),
  }));
}
