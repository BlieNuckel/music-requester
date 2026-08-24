import type { GraphEdge, GraphNode } from "@shared/recommenderGraph";

export type Position = { x: number; y: number };

export type LayoutMode = "authored" | "auto";

const COLUMN_WIDTH = 360;
const ROW_HEIGHT = 230;

/**
 * How far into the pipeline a node sits: one past its deepest input. The registry is
 * acyclic, but a guard is kept anyway so a future feedback edge degrades to a slightly odd
 * layout rather than a hung render.
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

function inputsByNode(edges: GraphEdge[]): Map<string, string[]> {
  const inputs = new Map<string, string[]>();
  for (const edge of edges) {
    inputs.set(edge.to, [...(inputs.get(edge.to) ?? []), edge.from]);
  }
  return inputs;
}

/**
 * Left-to-right layered layout: one column per pipeline depth, nodes stacked inside a column
 * in registry order. Deliberately plain. It exists to be compared against the authored
 * positions on the real node count, not to be a graph-drawing library.
 */
export function autoLayout(
  nodes: GraphNode[],
  edges: GraphEdge[]
): Map<string, Position> {
  const inputs = inputsByNode(edges);
  const memo = new Map<string, number>();
  const rows = new Map<number, number>();
  const positions = new Map<string, Position>();

  for (const node of nodes) {
    const depth = depthOf(node.id, inputs, memo, new Set());
    const row = rows.get(depth) ?? 0;
    rows.set(depth, row + 1);
    positions.set(node.id, { x: depth * COLUMN_WIDTH, y: row * ROW_HEIGHT });
  }
  return positions;
}

export function layoutPositions(
  nodes: GraphNode[],
  edges: GraphEdge[],
  mode: LayoutMode
): Map<string, Position> {
  if (mode === "auto") return autoLayout(nodes, edges);
  return new Map(nodes.map((node) => [node.id, node.position]));
}
