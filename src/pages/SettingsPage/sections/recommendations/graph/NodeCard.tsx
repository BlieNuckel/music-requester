import { useState } from "react";
import { Handle, Position } from "@xyflow/react";
import ParamControl from "./ParamControl";
import { parseFormula, reachableParamKeys } from "./formula";
import { useRecommenderParams } from "./paramsContext";
import {
  FLOWS,
  NODE_SCOPE_LABELS,
  SCOPE_EFFECT,
} from "@shared/recommenderGraph";
import type { NodeKind, NodeScope, ParamDef } from "@shared/recommenderGraph";
import type { RecommenderNodeData } from "./flowModel";
import type { NodeProps } from "@xyflow/react";

type NodeCardProps = { node: RecommenderNodeData["node"] };

const SCOPE_CLASS: Record<NodeScope, string> = {
  ingest: "bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-100",
  profile:
    "bg-violet-100 text-violet-900 dark:bg-violet-900 dark:text-violet-100",
  pick: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  serve:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
};

const KIND_BADGE: Partial<Record<NodeKind, string>> = {
  repeat: "repeats",
  fallback: "in order",
  quota: "quota",
  store: "stored",
  source: "external service",
  output: "shown",
};

function ParamSentence({
  param,
  known,
}: {
  param: ParamDef;
  known: ReadonlySet<string>;
}) {
  if (!param.formula) {
    return (
      <div className="space-y-1">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
          {param.label}
        </span>
        <ParamControl param={param} variant="inline" />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-gray-700 dark:text-gray-300">
      {parseFormula(param.formula, known).map((segment, index) =>
        segment.kind === "text" ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <ParamControl key={index} param={param} variant="inline" />
        )
      )}
    </div>
  );
}

function UsedParams({ params }: { params: ParamDef[] }) {
  if (params.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 pt-1">
      {params.map((param) => (
        <span
          key={param.key}
          title={`Set on another node: ${param.description}`}
          className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-[10px] font-medium text-gray-500 dark:text-gray-400"
        >
          also uses {param.label.toLowerCase()}
        </span>
      ))}
    </div>
  );
}

/**
 * A node belonging to another flow, drawn as a reference rather than redrawn in full: this
 * chart needs to say where its inputs come from without becoming the neighbouring chart.
 */
export function ExternalCard({ node }: NodeCardProps) {
  const { openFlow } = useRecommenderParams();
  const flow = FLOWS.find((entry) => entry.id === node.flow);

  return (
    <div className="w-[220px] rounded-xl border-2 border-dashed border-gray-400 bg-gray-50 dark:bg-gray-900 px-3 py-2 space-y-1">
      <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {flow?.label ?? "elsewhere"}
      </span>
      <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300">
        {node.title}
      </h3>
      <button
        type="button"
        onClick={() => openFlow(node.flow)}
        className="text-[11px] font-bold text-gray-500 dark:text-gray-400 hover:text-amber-600"
      >
        Open that flow
      </button>
    </div>
  );
}

/**
 * One node, and the knobs that belong to it rendered inside the sentence that says what it
 * does. The paragraph-length explanation stays folded away: the point of the graph is that
 * position and connection carry most of what a flat list had to spell out.
 */
export function NodeCard({ node }: NodeCardProps) {
  const [open, setOpen] = useState(false);
  const known = reachableParamKeys(node.params, node.usesParams);
  const badge = KIND_BADGE[node.kind];

  return (
    <div className="w-[300px] rounded-xl border-2 border-black bg-white dark:bg-gray-800 shadow-cartoon-md overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b-2 border-black">
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${SCOPE_CLASS[node.scope]}`}
        >
          {NODE_SCOPE_LABELS[node.scope]}
        </span>
        <div className="flex items-center gap-1">
          {node.spendsBudget && (
            <span
              title="Spends the build's shared MusicBrainz lookup budget"
              className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900 text-[10px] font-bold text-rose-900 dark:text-rose-100"
            >
              budget
            </span>
          )}
          {badge && (
            <span className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-[10px] font-bold text-gray-700 dark:text-gray-300">
              {badge}
            </span>
          )}
        </div>
      </div>

      <div className="px-3 py-2 space-y-2">
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
          {node.title}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {node.summary}
        </p>

        {node.note && (
          <p className="text-xs italic text-amber-700 dark:text-amber-300">
            {node.note}
          </p>
        )}

        {node.params.map((param) => (
          <ParamSentence key={param.key} param={param} known={known} />
        ))}

        <UsedParams params={node.usesParams} />

        {node.params.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setOpen((prev) => !prev)}
              className="text-[11px] font-bold text-gray-500 dark:text-gray-400 hover:text-amber-600"
            >
              {open ? "Hide details" : "What do these do?"}
            </button>
            {open && (
              <div className="mt-1 space-y-2">
                {node.params.map((param) => (
                  <p
                    key={param.key}
                    className="text-[11px] leading-snug text-gray-500 dark:text-gray-400"
                  >
                    <span className="font-bold">{param.label}. </span>
                    {param.description}
                  </p>
                ))}
                <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500">
                  {SCOPE_EFFECT[node.scope]}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The canvas wrapper: the same card, plus the edge attachment points. */
export default function RecommenderNode({
  data,
}: NodeProps & { data: RecommenderNodeData }) {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      {data.external ? (
        <ExternalCard node={data.node} />
      ) : (
        <NodeCard node={data.node} />
      )}
      <Handle type="source" position={Position.Right} />
    </>
  );
}
