import { Handle } from "@xyflow/react";
import ParamControl from "./ParamControl";
import HelpTip from "./HelpTip";
import { parseEffect, reachableParams } from "./effect";
import { useRecommenderParams } from "./paramsContext";
import {
  FLOWS,
  NODE_KIND_LABELS,
  NODE_KIND_MEANING,
  SCOPE_EFFECT,
} from "@shared/recommenderGraph";
import { BAR_KINDS } from "./paramKinds";
import { kindBadgeClass } from "./nodeKinds";
import type { GraphNodeParam, ParamDef } from "@shared/recommenderGraph";
import type { NodeRun, TraceFact } from "@shared/recommendationTrace";
import { HANDLE_SIDES } from "./flowModel";
import type { RecommenderNodeData } from "./flowModel";
import type { NodeProps } from "@xyflow/react";

type NodeCardProps = { node: RecommenderNodeData["node"] };

type TraceProps = Pick<RecommenderNodeData, "run" | "skipped" | "source">;

/**
 * A bar is as wide as the card and states its own value, so it takes a row to itself with
 * its name above and what it changes underneath. Threaded into a sentence it read as an
 * expression to solve rather than a setting, which is the thing it was meant to spare
 * anyone doing.
 */
/**
 * What moving a knob on this card costs. Derived from scope, but stated per card rather than
 * badged per node: it answers a question only a card with knobs can be asked, and two thirds
 * of the chart has none. A shared knob answers for its owner, which is not always this node.
 */
function EditCost({ node }: NodeCardProps) {
  const costs = new Set<string>();
  if (node.params.length > 0) costs.add(SCOPE_EFFECT[node.scope]);
  for (const param of node.usesParams)
    costs.add(SCOPE_EFFECT[param.ownerScope]);
  if (costs.size === 0) return null;

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-1.5">
      {[...costs].map((cost) => (
        <p
          key={cost}
          className="text-[10px] font-medium text-gray-400 dark:text-gray-500"
        >
          {cost}
        </p>
      ))}
    </div>
  );
}

function ParamBar({ param }: { param: ParamDef }) {
  return (
    <div className="space-y-0.5">
      <span className="flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
        {param.label}
        <HelpTip label={param.label} text={param.description} />
      </span>
      <ParamControl param={param} variant="inline" />
      {param.effect && (
        <p className="text-[11px] leading-snug text-gray-500 dark:text-gray-400">
          {param.effect}
        </p>
      )}
    </div>
  );
}

function ParamSentence({
  param,
  reachable,
}: {
  param: ParamDef;
  reachable: ReadonlyMap<string, ParamDef>;
}) {
  if (BAR_KINDS.has(param.kind)) return <ParamBar param={param} />;

  if (!param.effect) {
    return (
      <div className="space-y-1">
        <span className="flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
          {param.label}
          <HelpTip label={param.label} text={param.description} />
        </span>
        <ParamControl param={param} variant="inline" />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-gray-700 dark:text-gray-300">
      {parseEffect(param.effect, reachable).map((segment, index) =>
        segment.kind === "text" ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <ParamControl
            key={index}
            param={reachable.get(segment.key) ?? param}
            variant="inline"
          />
        )
      )}
      <HelpTip label={param.label} text={param.description} />
    </div>
  );
}

/**
 * What a step takes, does and gives, as three scannable lists. This is the description now:
 * the same facts written as prose read as wordy to everyone who did not already know the
 * code, because a paragraph makes the reader work out which half is the input.
 */
function Anatomy({ node }: NodeCardProps) {
  return (
    <div className="space-y-1.5">
      <Lines label="Takes" lines={node.takes} />
      <Lines label="Does" lines={node.does} />
      <Lines label="Gives" lines={[node.gives]} />
    </div>
  );
}

function Lines({ label, lines }: { label: string; lines: string[] }) {
  return (
    <div>
      <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {label}
      </span>
      <ul className="space-y-0.5">
        {lines.map((line) => (
          <li
            key={line}
            className="flex gap-1.5 text-xs leading-snug text-gray-600 dark:text-gray-300"
          >
            <span aria-hidden className="text-gray-400 dark:text-gray-600">
              •
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Knobs owned by another step, editable here too. One knob is one stored value however many
 * steps read it, so the two places cannot disagree — and a step whose behaviour changes when
 * the knob moves is a step someone can reasonably expect to change it from. What the naming
 * has to keep is that it is the same knob and not a second one, which is what the owner's
 * name under each is for.
 */
function UsedParams({
  params,
  reachable,
}: {
  params: GraphNodeParam[];
  reachable: ReadonlyMap<string, ParamDef>;
}) {
  const { openFlow } = useRecommenderParams();
  if (params.length === 0 || !openFlow) return null;

  return (
    <div className="space-y-2 border-t border-dashed border-gray-300 dark:border-gray-600 pt-2">
      <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        Shared
      </span>
      {params.map((param) => (
        <div key={param.key} className="space-y-0.5">
          <ParamSentence param={param} reachable={reachable} />
          <button
            type="button"
            onClick={() => openFlow(param.ownerFlow, param.owner)}
            className="nodrag block text-[10px] font-medium text-gray-400 dark:text-gray-500 hover:text-amber-600"
          >
            also on {param.ownerTitle}
          </button>
        </div>
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
      {openFlow && (
        <button
          type="button"
          onClick={() => openFlow(node.flow, node.id)}
          className="nodrag text-[11px] font-bold text-gray-500 dark:text-gray-400 hover:text-amber-600"
        >
          Open that flow
        </button>
      )}
    </div>
  );
}

function FactItems({ fact }: { fact: TraceFact }) {
  return (
    <ul className="space-y-0.5">
      {(fact.items ?? []).map((item) => (
        <li
          key={item.name}
          data-testid={item.chosen ? "trace-chosen" : "trace-item"}
          className={`flex gap-1.5 text-xs leading-snug ${
            item.chosen
              ? "font-bold text-amber-700 dark:text-amber-300"
              : "text-gray-600 dark:text-gray-300"
          }`}
        >
          <span aria-hidden className="text-gray-400 dark:text-gray-600">
            {item.chosen ? "★" : "•"}
          </span>
          <span>
            {item.name}
            {item.detail && (
              <span className="text-gray-400 dark:text-gray-500">
                {" "}
                — {item.detail}
              </span>
            )}
          </span>
        </li>
      ))}
      {fact.more !== undefined && (
        <li className="text-[11px] italic text-gray-400 dark:text-gray-500">
          and {fact.more} more
        </li>
      )}
    </ul>
  );
}

/**
 * What this step did on the run being explained. The card keeps saying what the step is for
 * above this: a fact reads as an answer only next to the question it answers.
 */
function Facts({ run }: { run: NodeRun }) {
  return (
    <div
      data-testid="node-facts"
      className="space-y-1.5 border-t-2 border-black pt-2"
    >
      {run.facts.length === 0 && (
        <p className="text-xs italic text-gray-400 dark:text-gray-500">
          {run.produced ? run.summary : "came up with nothing"}
        </p>
      )}
      {run.facts.map((fact) => (
        <div key={fact.label}>
          <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
            {fact.label}
          </span>
          {fact.value && (
            <p className="text-xs leading-snug text-gray-700 dark:text-gray-200">
              {fact.value}
            </p>
          )}
          {fact.items && <FactItems fact={fact} />}
        </div>
      ))}
    </div>
  );
}

/**
 * One node, and the knobs that belong to it rendered inside the line that says what each one
 * changes. The paragraph explaining a knob hangs off the knob itself, where someone reaches
 * for it: a card that grows when asked a question has to be laid out twice and pushes its
 * neighbours around to answer one.
 */
export function NodeCard({
  node,
  run,
  skipped,
  source,
}: NodeCardProps & TraceProps) {
  const { arrivedAt } = useRecommenderParams();
  const reachable = reachableParams(node.params, node.usesParams);
  const highlighted = arrivedAt === node.id || source;

  return (
    <div
      data-kind={node.kind}
      data-arrived={arrivedAt === node.id ? "true" : undefined}
      data-skipped={skipped ? "true" : undefined}
      data-source={source ? "true" : undefined}
      className={`w-[300px] rounded-xl border-2 border-black bg-white dark:bg-gray-800 shadow-cartoon-md overflow-hidden ${
        skipped ? "opacity-40 grayscale" : ""
      } ${
        highlighted
          ? "ring-4 ring-amber-400 ring-offset-2 ring-offset-gray-50 dark:ring-offset-gray-900"
          : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b-2 border-black">
        <span
          title={NODE_KIND_MEANING[node.kind]}
          className={`uppercase tracking-wide ${kindBadgeClass(node.kind)}`}
        >
          {NODE_KIND_LABELS[node.kind]}
        </span>
        <div className="flex items-center gap-1">
          {node.status === "ported" && (
            <span
              title={`Written for the graph but not wired up yet — the recommender still runs the old path. Body: ${node.module ?? ""}`}
              className="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900 text-[10px] font-bold text-indigo-900 dark:text-indigo-100"
            >
              not live
            </span>
          )}
          {node.spendsBudget && (
            <span
              title="Spends the build's shared MusicBrainz lookup budget"
              className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900 text-[10px] font-bold text-rose-900 dark:text-rose-100"
            >
              budget
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

        <Anatomy node={node} />

        {node.params.map((param) => (
          <ParamSentence key={param.key} param={param} reachable={reachable} />
        ))}

        <UsedParams params={node.usesParams} reachable={reachable} />

        {run && <Facts run={run} />}

        <EditCost node={node} />
      </div>
    </div>
  );
}

/** The canvas wrapper: the same card, plus the edge attachment points. */
export default function RecommenderNode({
  data,
}: NodeProps & { data: RecommenderNodeData }) {
  const sides = HANDLE_SIDES[data.direction];

  return (
    <>
      <Handle type="target" position={sides.target} />
      {data.external ? (
        <ExternalCard node={data.node} />
      ) : (
        <NodeCard
          node={data.node}
          run={data.run}
          skipped={data.skipped}
          source={data.source}
        />
      )}
      <Handle type="source" position={sides.source} />
    </>
  );
}
