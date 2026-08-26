import type { FlowNode } from "./flowSelection";
import type { GraphEdge, GraphNode } from "@shared/recommenderGraph";

export type Position = { x: number; y: number };

export type LayoutDirection = "LR" | "TB";

export type Spacing = "compact" | "comfortable" | "roomy";

export type LayoutOptions = { direction: LayoutDirection; spacing: Spacing };

export type NodeBox = Position & { width: number; height: number };

/** One hop of the layout graph: a real edge, or a slice of one crossing a lane. */
type Segment = { from: string; to: string };

/**
 * A slot in a lane. Real nodes are cards; spacers are the room an edge needs to cross a lane
 * it has no business landing in, and are never rendered.
 *
 * Sizes are named for the flow rather than for the screen — `along` is how much of the
 * pipeline's direction the slot occupies, `across` how much of the other one — so the
 * placement maths is written once and the direction is applied at the end.
 */
type Cell = {
  id: string;
  along: number;
  across: number;
  center: number;
  spacer: boolean;
};

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

/** Room reserved in a lane for one edge passing through it, label included. */
const EDGE_LANE = 44;

/** Barycentre sweeps. Four is where the crossing count stops improving in practice. */
const ORDER_PASSES = 4;

/** Sweeps of the lane-balancing pass. It settles well before this on a chart of this size. */
const BALANCE_PASSES = 8;

const lines = (text: string): number =>
  Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));

const wrapped = (text: string): number => lines(text) * LINE_HEIGHT;

const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

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

function adjacency(edges: GraphEdge[]): {
  inputs: Map<string, string[]>;
  outputs: Map<string, string[]>;
} {
  const inputs = new Map<string, string[]>();
  const outputs = new Map<string, string[]>();

  for (const edge of edges) {
    inputs.set(edge.to, [...(inputs.get(edge.to) ?? []), edge.from]);
    outputs.set(edge.from, [...(outputs.get(edge.from) ?? []), edge.to]);
  }
  return { inputs, outputs };
}

/** Where a node may sit without any edge running backwards. */
function feasibleLanes(
  id: string,
  inputs: Map<string, string[]>,
  outputs: Map<string, string[]>,
  layers: Map<string, number>
): { lo: number; hi: number; ins: number; outs: number } {
  const ins = inputs.get(id) ?? [];
  const outs = outputs.get(id) ?? [];
  const lo = ins.length
    ? Math.max(...ins.map((from) => layers.get(from) ?? 0)) + 1
    : 0;
  const hi = outs.length
    ? Math.min(...outs.map((to) => layers.get(to) ?? 0)) - 1
    : lo;

  return { lo, hi, ins: ins.length, outs: outs.length };
}

/**
 * Which lane each node sits in. Every node starts as early as its inputs permit, then slides
 * within the range where no edge would run backwards, towards whichever side it has more
 * edges on — and to the middle of that range when it has as many of each.
 *
 * Earliest-possible alone reads badly. "Listening over time" needs only the raw log, so it
 * landed beside the loader with its output crossing the entire chart to reach the node that
 * reads it, over six cards it has nothing to do with. Latest-possible alone simply moves the
 * problem onto the incoming edge. Sliding by degree shortens whichever side has more to lose,
 * and centring the ties halves the worst edge of a node that merely bridges two distant ends.
 */
function assignLayers(
  nodes: FlowNode[],
  edges: GraphEdge[]
): Map<string, number> {
  const { inputs, outputs } = adjacency(edges);
  const memo = new Map<string, number>();
  const layers = new Map<string, number>();
  const ids = nodes.map((entry) => entry.node.id);

  for (const id of ids) layers.set(id, depthOf(id, inputs, memo, new Set()));

  for (let pass = 0; pass < BALANCE_PASSES; pass += 1) {
    for (const id of ids) {
      const { lo, hi, ins, outs } = feasibleLanes(id, inputs, outputs, layers);
      if (lo > hi) continue;

      if (ins > outs) layers.set(id, lo);
      else if (outs > ins) layers.set(id, hi);
      else layers.set(id, Math.round((lo + hi) / 2));
    }
  }

  const first = Math.min(...layers.values());
  for (const id of ids) layers.set(id, (layers.get(id) ?? 0) - first);
  return layers;
}

/**
 * Lanes of slots, with a spacer inserted wherever an edge crosses a lane it does not stop
 * in. The spacer holds a corridor open, so a long edge runs through empty space instead of
 * over the cards that happen to sit between its ends.
 */
function buildColumns(
  nodes: FlowNode[],
  edges: GraphEdge[],
  layers: Map<string, number>,
  direction: LayoutDirection
): { columns: Cell[][]; segments: Segment[] } {
  const depth = Math.max(0, ...layers.values());
  const columns: Cell[][] = Array.from({ length: depth + 1 }, () => []);
  const segments: Segment[] = [];

  for (const entry of nodes) {
    const width = nodeWidth(entry);
    const height = estimateNodeHeight(entry.node, entry.external);
    columns[layers.get(entry.node.id) ?? 0].push({
      id: entry.node.id,
      along: direction === "LR" ? width : height,
      across: direction === "LR" ? height : width,
      center: 0,
      spacer: false,
    });
  }

  for (const edge of edges) {
    const from = layers.get(edge.from);
    const to = layers.get(edge.to);
    if (from === undefined || to === undefined) continue;

    let previous = edge.from;
    for (let lane = from + 1; lane < to; lane += 1) {
      const id = `${edge.id}@${lane}`;
      columns[lane].push({
        id,
        along: 0,
        across: EDGE_LANE,
        center: 0,
        spacer: true,
      });
      segments.push({ from: previous, to: id });
      previous = id;
    }
    segments.push({ from: previous, to: edge.to });
  }
  return { columns, segments };
}

function neighboursOf(segments: Segment[]): {
  before: Map<string, string[]>;
  after: Map<string, string[]>;
} {
  const before = new Map<string, string[]>();
  const after = new Map<string, string[]>();

  for (const segment of segments) {
    before.set(segment.to, [...(before.get(segment.to) ?? []), segment.from]);
    after.set(segment.from, [...(after.get(segment.from) ?? []), segment.to]);
  }
  return { before, after };
}

/** One node's target slot: the average slot of what it connects to in the neighbouring lane. */
function barycentre(
  cell: Cell,
  neighbours: Map<string, string[]>,
  slots: Map<string, number>,
  fallback: number
): number {
  const known = (neighbours.get(cell.id) ?? [])
    .map((id) => slots.get(id))
    .filter((slot): slot is number => slot !== undefined);

  return known.length ? mean(known) : fallback;
}

function slotIndex(columns: Cell[][]): Map<string, number> {
  const slots = new Map<string, number>();
  for (const column of columns) {
    column.forEach((cell, index) => slots.set(cell.id, index));
  }
  return slots;
}

/**
 * Order each lane so that connected slots line up across lanes, which is what removes
 * crossings. Sweeps forwards and backwards: a lane can only be ordered against one side at a
 * time, and alternating lets both sides pull on it.
 */
function orderColumns(columns: Cell[][], segments: Segment[]): void {
  const { before, after } = neighboursOf(segments);

  for (let pass = 0; pass < ORDER_PASSES; pass += 1) {
    const forward = pass % 2 === 0;
    const order = forward
      ? columns.map((_, index) => index)
      : columns.map((_, index) => columns.length - 1 - index);

    for (const index of order) {
      const slots = slotIndex(columns);
      const neighbours = forward ? before : after;
      const keyed = columns[index].map((cell, position) => ({
        cell,
        key: barycentre(cell, neighbours, slots, position),
        position,
      }));

      keyed.sort((a, b) => a.key - b.key || a.position - b.position);
      columns[index] = keyed.map((entry) => entry.cell);
    }
  }
}

/**
 * Place every slot along the cross axis: aligned with what feeds it where there is room, and
 * pushed clear of the slot above it where there is not. Stacking alone packs every lane
 * against the top edge, which reads as a wall of cards rather than as a flow.
 */
function placeColumns(
  columns: Cell[][],
  segments: Segment[],
  gap: number
): void {
  const { before } = neighboursOf(segments);
  const centres = new Map<string, number>();

  for (const column of columns) {
    let bottom = -gap;

    for (const cell of column) {
      const free = bottom + gap + cell.across / 2;
      const target = barycentre(cell, before, centres, free);
      cell.center = Math.max(target, free);
      bottom = cell.center + cell.across / 2;
      centres.set(cell.id, cell.center);
    }
  }
}

function toPositions(
  columns: Cell[][],
  direction: LayoutDirection,
  gap: number
): Map<string, Position> {
  const positions = new Map<string, Position>();
  let offset = 0;

  for (const column of columns) {
    for (const cell of column) {
      if (cell.spacer) continue;
      const across = cell.center - cell.across / 2;
      positions.set(
        cell.id,
        direction === "LR" ? { x: offset, y: across } : { x: across, y: offset }
      );
    }
    const extent = Math.max(0, ...column.map((cell) => cell.along));
    offset += extent + gap * 2;
  }
  return positions;
}

/**
 * Layered layout: one lane per step of the pipeline, ordered so connected cards line up and
 * spaced so a long edge has somewhere to run that is not across an unrelated card.
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
  const known = new Set(nodes.map((entry) => entry.node.id));
  const inFlow = edges.filter(
    (edge) => known.has(edge.from) && known.has(edge.to)
  );

  const layers = assignLayers(nodes, inFlow);
  const { columns, segments } = buildColumns(
    nodes,
    inFlow,
    layers,
    options.direction
  );
  orderColumns(columns, segments);
  placeColumns(columns, segments, gap);

  return toPositions(columns, options.direction, gap);
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
