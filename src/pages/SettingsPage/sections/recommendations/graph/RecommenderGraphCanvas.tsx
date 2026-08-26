import { useEffect, useMemo, useRef } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
} from "@xyflow/react";
import RecommenderNode from "./NodeCard";
import { buildFlow, layoutPositions } from "./flowModel";
import { useRecommenderParams } from "./paramsContext";
import { kindBadgeClass } from "./nodeKinds";
import { useTheme } from "@/context/useTheme";
import {
  FLOWS,
  NODE_KIND_LABELS,
  NODE_KIND_MEANING,
} from "@shared/recommenderGraph";
import type { LayoutOptions, MeasuredSizes } from "./autoLayout";
import type { ActualTheme } from "@/context/themeContextDef";
import type {
  FlowId,
  NodeKind,
  RecommenderGraph,
} from "@shared/recommenderGraph";
import "@xyflow/react/dist/style.css";

type RecommenderGraphCanvasProps = {
  graph: RecommenderGraph;
  flow: FlowId;
  layout: LayoutOptions;
};

type LegendEntry = { label: string; className: string; note: string };

const nodeTypes = { recommenderNode: RecommenderNode };

/**
 * The flow library's `colorMode` themes the canvas chrome, but the minimap paints its own
 * surface and would stay a white rectangle in the dark theme.
 */
const MINIMAP_COLORS: Record<ActualTheme, Record<string, string>> = {
  light: { bg: "#f9fafb", mask: "rgba(15, 23, 42, 0.08)", node: "#d1d5db" },
  dark: { bg: "#111827", mask: "rgba(0, 0, 0, 0.45)", node: "#4b5563" },
};

const LEGEND: LegendEntry[] = [
  {
    label: "feeds",
    className: "border-gray-500",
    note: "the output of one step is the input of the next",
  },
  {
    label: "falls back to",
    className: "border-amber-500 border-dashed",
    note: "tried in order, and only until one answers",
  },
  {
    label: "triggers",
    className: "border-blue-400 border-dotted",
    note: "starts the next step rather than feeding it",
  },
];

/**
 * The kinds this flow actually contains, in the registry's own order. Listing all seven
 * would explain four badges the reader cannot see from here.
 */
function kindsInFlow(graph: RecommenderGraph, flow: FlowId): NodeKind[] {
  const seen = new Set<NodeKind>();
  for (const node of graph.nodes) {
    if (node.flow === flow) seen.add(node.kind);
  }
  return [...seen];
}

function Legend({ graph, flow }: Omit<RecommenderGraphCanvasProps, "layout">) {
  const spendsBudget = graph.nodes.some(
    (node) => node.flow === flow && node.spendsBudget
  );
  const kinds = kindsInFlow(graph, flow);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
      {LEGEND.map((entry) => (
        <span key={entry.label} className="flex items-center gap-2">
          <span className={`w-6 border-t-2 ${entry.className}`} />
          <span className="font-bold">{entry.label}</span>
          <span>{entry.note}</span>
        </span>
      ))}
      <span className="flex items-center gap-2">
        <span className="w-6 border-t-2 border-dashed border-gray-400" />
        <span>dashed box: a step owned by another flow</span>
      </span>
      {kinds.map((kind) => (
        <span key={kind} className="flex items-center gap-2">
          <span className={kindBadgeClass(kind)}>{NODE_KIND_LABELS[kind]}</span>
          <span>{NODE_KIND_MEANING[kind]}</span>
        </span>
      ))}
      {spendsBudget &&
        graph.budgets.map((budget) => (
          <span key={budget.id} title={budget.description}>
            <span className="font-bold">budget</span> {budget.amount}{" "}
            {budget.label.toLowerCase()}, shared by every source
          </span>
        ))}
    </div>
  );
}

type FlowApi = Pick<ReturnType<typeof useReactFlow>, "getNodes" | "setNodes">;

function settleOnMeasured(
  { graph, flow, layout }: RecommenderGraphCanvasProps,
  { getNodes, setNodes }: FlowApi
): void {
  const measured: MeasuredSizes = new Map(
    getNodes().map((node) => [
      node.id,
      {
        width: node.measured?.width ?? 0,
        height: node.measured?.height ?? 0,
      },
    ])
  );

  const positions = layoutPositions(graph, flow, layout, measured);
  setNodes((current) =>
    current.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? node.position,
    }))
  );
}

/**
 * Lay the flow out again once the cards exist, against the heights the browser actually gave
 * them rather than the estimate the first pass had to work from, then look at whatever this
 * visit came for.
 *
 * The estimate cannot be right. A tag editor is as tall as the number of tags it holds and
 * how they wrap, and the graph carries no values for an estimate to read — so the card that
 * lists every generic tag came out around two hundred pixels short and sat on top of its
 * neighbour. Measuring is the only thing that knows.
 *
 * The measuring happens once, but the looking cannot: over half the references a card offers
 * name a step in the flow already on screen, and following one of those changes neither the
 * flow nor the layout, so nothing remounts. Latching both together left those references
 * ringing a card the viewport was never moved to.
 */
function SettleOnMeasured({
  graph,
  flow,
  layout,
}: RecommenderGraphCanvasProps) {
  const initialized = useNodesInitialized();
  const { getNodes, setNodes, fitView } = useReactFlow();
  const { arrivedAt } = useRecommenderParams();
  const settled = useRef(false);

  useEffect(() => {
    if (!initialized) return;
    if (!settled.current) {
      settled.current = true;
      settleOnMeasured({ graph, flow, layout }, { getNodes, setNodes });
    }

    // Land on the node a reference was followed into rather than on the whole chart, with
    // enough room around it to see what it connects to.
    const landing =
      arrivedAt && getNodes().some((node) => node.id === arrivedAt);
    void fitView(
      landing
        ? { nodes: [{ id: arrivedAt }], maxZoom: 1, padding: 1.2 }
        : undefined
    );
  }, [
    initialized,
    graph,
    flow,
    layout,
    arrivedAt,
    getNodes,
    setNodes,
    fitView,
  ]);

  return null;
}

/**
 * One flow as a pan-and-zoom canvas. Nodes are uncontrolled, so dragging one is free and
 * switching flow remounts the canvas with a fresh layout: dragged positions are for looking
 * at the graph, not something the app remembers.
 */
export default function RecommenderGraphCanvas({
  graph,
  flow,
  layout,
}: RecommenderGraphCanvasProps) {
  const built = useMemo(
    () => buildFlow(graph, flow, layout),
    [graph, flow, layout]
  );
  const definition = FLOWS.find((entry) => entry.id === flow);
  const { actualTheme } = useTheme();
  const minimap = MINIMAP_COLORS[actualTheme];

  return (
    <div className="space-y-3">
      {definition && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {definition.summary}
        </p>
      )}
      <div
        data-testid="recommender-canvas"
        className="h-[70vh] min-h-[420px] rounded-xl border-2 border-black overflow-hidden bg-gray-50 dark:bg-gray-900"
      >
        <ReactFlow
          key={`${flow}:${layout.direction}:${layout.spacing}`}
          defaultNodes={built.nodes}
          defaultEdges={built.edges}
          nodeTypes={nodeTypes}
          colorMode={actualTheme}
          fitView
          minZoom={0.1}
          proOptions={{ hideAttribution: false }}
        >
          <SettleOnMeasured graph={graph} flow={flow} layout={layout} />
          <Background />
          <Controls />
          <MiniMap
            pannable
            zoomable
            bgColor={minimap.bg}
            maskColor={minimap.mask}
            nodeColor={minimap.node}
          />
        </ReactFlow>
      </div>
      <Legend graph={graph} flow={flow} />
    </div>
  );
}
