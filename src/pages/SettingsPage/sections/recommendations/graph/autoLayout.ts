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
 * How far into the flow a node sits: one past its deepest input. The registry is acyclic,
 * but a guard is kept anyway so a future feedback edge degrades to a slightly odd layout
 * rather than a hung render.
 */
function depthOf(
  id: string,
  inputs: Map<string, string[]>,
  memo: Map<string, number>,
  visiting: Set<string>
): number {
  const known = memo.get(id);
  if (known !== undefined) return known;
  if (visiting.has(id)) return 0;

  visiting.add(id);
  const parents = inputs.get(id) ?? [];
  const depth = parents.length
    ? Math.max(...parents.map((p) => depthOf(p, inputs, memo, visiting))) + 1
    : 0;
  visiting.delete(id);

  memo.set(id, depth);
  return depth;
}

function inputsByNode(
  edges: GraphEdge[],
  known: ReadonlySet<string>
): Map<string, string[]> {
  const inputs = new Map<string, string[]>();
  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    inputs.set(edge.to, [...(inputs.get(edge.to) ?? []), edge.from]);
  }
  return inputs;
}

/** Nodes grouped by pipeline depth, keeping registry order inside a group. */
function byDepth(
  nodes: FlowNode[],
  edges: GraphEdge[]
): Map<number, FlowNode[]> {
  const known = new Set(nodes.map((entry) => entry.node.id));
  const inputs = inputsByNode(edges, known);
  const memo = new Map<string, number>();
  const groups = new Map<number, FlowNode[]>();

  for (const entry of nodes) {
    const depth = depthOf(entry.node.id, inputs, memo, new Set());
    groups.set(depth, [...(groups.get(depth) ?? []), entry]);
  }
  return groups;
}

/** Place one lane along the cross axis, stacked by each node's own size. */
function placeGroup(
  group: FlowNode[],
  offset: number,
  gap: number,
  direction: LayoutDirection,
  positions: Map<string, Position>
): number {
  let cursor = 0;
  let extent = 0;

  for (const entry of group) {
    const width = nodeWidth(entry);
    const height = estimateNodeHeight(entry.node, entry.external);
    positions.set(
      entry.node.id,
      direction === "LR" ? { x: offset, y: cursor } : { x: cursor, y: offset }
    );
    cursor += (direction === "LR" ? height : width) + gap;
    extent = Math.max(extent, direction === "LR" ? width : height);
  }
  return extent;
}

/**
 * Layered layout: one lane per pipeline depth, nodes stacked inside a lane by their own
 * estimated size rather than on a fixed pitch. A fixed pitch is what made tall cards overlap
 * the ones below them, which hides the very knobs the chart exists to show.
 *
 * Authored coordinates were tried first and lost: they went stale the moment a node moved,
 * and the computed lanes read better anyway.
 */
export function autoLayout(
  nodes: FlowNode[],
  edges: GraphEdge[],
  options: LayoutOptions = { direction: "LR", spacing: "comfortable" }
): Map<string, Position> {
  const gap = GAPS[options.spacing];
  const groups = byDepth(nodes, edges);
  const positions = new Map<string, Position>();
  let offset = 0;

  for (const depth of [...groups.keys()].sort((a, b) => a - b)) {
    const extent = placeGroup(
      groups.get(depth)!,
      offset,
      gap,
      options.direction,
      positions
    );
    offset += extent + gap * 2;
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
