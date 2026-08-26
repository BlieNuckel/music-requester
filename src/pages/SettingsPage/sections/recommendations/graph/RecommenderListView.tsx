import ParamControl from "./ParamControl";
import { useRecommenderParams } from "./paramsContext";
import { NODE_SCOPE_LABELS, SCOPE_EFFECT } from "@shared/recommenderGraph";
import type {
  FlowId,
  GraphNode,
  RecommenderGraph,
} from "@shared/recommenderGraph";

type RecommenderListViewProps = { graph: RecommenderGraph; flow: FlowId };

function NodeSection({ node }: { node: GraphNode }) {
  const { arrivedAt } = useRecommenderParams();

  return (
    <section
      data-arrived={arrivedAt === node.id ? "true" : undefined}
      className={`space-y-3 pt-4 border-t-2 border-dashed border-gray-200 dark:border-gray-700 ${
        arrivedAt === node.id
          ? "-mx-2 px-2 rounded-lg ring-4 ring-amber-400"
          : ""
      }`}
    >
      <div>
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
            {node.title}
          </h3>
          <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
            {NODE_SCOPE_LABELS[node.scope]}
          </span>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {node.summary}
        </p>
        <dl className="mt-2 space-y-1 text-xs text-gray-500 dark:text-gray-400">
          {(
            [
              ["Takes", node.takes],
              ["Does", node.does],
              ["Gives", [node.gives]],
            ] as const
          ).map(([label, lines]) => (
            <div key={label} className="flex gap-2">
              <dt className="w-12 shrink-0 font-bold uppercase tracking-wide text-[10px] pt-0.5 text-gray-400 dark:text-gray-500">
                {label}
              </dt>
              <dd>
                <ul className="list-disc pl-4 space-y-0.5">
                  {lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {node.params.map((param) => (
        <div key={param.key} className="space-y-1">
          {param.kind !== "boolean" && (
            <span className="block text-sm font-medium text-gray-600 dark:text-gray-400">
              {param.label}
            </span>
          )}
          <ParamControl param={param} variant="block" />
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {param.description}
          </p>
        </div>
      ))}

      <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500">
        {SCOPE_EFFECT[node.scope]}
      </p>
    </section>
  );
}

/**
 * The same knobs as the canvas, from the same registry, as a plain form. A pan-and-zoom
 * canvas is the wrong tool on a narrow screen or with a screen reader, and keeping a second
 * hand-written list is what this whole change is getting rid of.
 */
export default function RecommenderListView({
  graph,
  flow,
}: RecommenderListViewProps) {
  const withParams = graph.nodes.filter(
    (node) => node.flow === flow && node.params.length > 0
  );

  if (withParams.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Nothing to configure in this flow.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {withParams.map((node) => (
        <NodeSection key={node.id} node={node} />
      ))}
    </div>
  );
}
