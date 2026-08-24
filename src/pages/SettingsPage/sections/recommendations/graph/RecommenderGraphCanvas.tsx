import { useMemo } from "react";
import { Background, Controls, MiniMap, ReactFlow } from "@xyflow/react";
import RecommenderNode from "./NodeCard";
import { buildFlow } from "./flowModel";
import type { LayoutMode } from "./autoLayout";
import type { RecommenderGraph } from "@shared/recommenderGraph";
import "@xyflow/react/dist/style.css";

type RecommenderGraphCanvasProps = {
  graph: RecommenderGraph;
  layout: LayoutMode;
};

type LegendEntry = { label: string; className: string; note: string };

const nodeTypes = { recommenderNode: RecommenderNode };

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

function Legend({ graph }: { graph: RecommenderGraph }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
      {LEGEND.map((entry) => (
        <span key={entry.label} className="flex items-center gap-2">
          <span className={`w-6 border-t-2 ${entry.className}`} />
          <span className="font-bold">{entry.label}</span>
          <span>{entry.note}</span>
        </span>
      ))}
      {graph.budgets.map((budget) => (
        <span key={budget.id} title={budget.description}>
          <span className="font-bold">budget</span> {budget.amount}{" "}
          {budget.label.toLowerCase()}, shared by every source
        </span>
      ))}
    </div>
  );
}

/**
 * The pipeline as a pan-and-zoom canvas. Nodes are uncontrolled, so dragging one is free
 * and switching layout remounts the flow with fresh positions: dragged positions are for
 * looking at the graph, not something the app remembers.
 */
export default function RecommenderGraphCanvas({
  graph,
  layout,
}: RecommenderGraphCanvasProps) {
  const flow = useMemo(() => buildFlow(graph, layout), [graph, layout]);

  return (
    <div className="space-y-3">
      <div
        data-testid="recommender-canvas"
        className="h-[70vh] min-h-[420px] rounded-xl border-2 border-black overflow-hidden bg-gray-50 dark:bg-gray-900"
      >
        <ReactFlow
          key={layout}
          defaultNodes={flow.nodes}
          defaultEdges={flow.edges}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.1}
          proOptions={{ hideAttribution: false }}
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      <Legend graph={graph} />
    </div>
  );
}
