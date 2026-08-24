import { useMemo } from "react";
import { Background, Controls, MiniMap, ReactFlow } from "@xyflow/react";
import RecommenderNode from "./NodeCard";
import { buildFlow } from "./flowModel";
import { FLOWS } from "@shared/recommenderGraph";
import type { LayoutOptions } from "./autoLayout";
import type { FlowId, RecommenderGraph } from "@shared/recommenderGraph";
import "@xyflow/react/dist/style.css";

type RecommenderGraphCanvasProps = {
  graph: RecommenderGraph;
  flow: FlowId;
  layout: LayoutOptions;
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

function Legend({ graph, flow }: Omit<RecommenderGraphCanvasProps, "layout">) {
  const spendsBudget = graph.nodes.some(
    (node) => node.flow === flow && node.spendsBudget
  );

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
          fitView
          minZoom={0.1}
          proOptions={{ hideAttribution: false }}
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      <Legend graph={graph} flow={flow} />
    </div>
  );
}
