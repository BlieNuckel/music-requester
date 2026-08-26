import ParamControl from "@/components/recommenderGraph/ParamControl";
import type { RetiredParam } from "@shared/recommenderGraph";

type RetiredParamsProps = { params: RetiredParam[] };

/**
 * Knobs no node reads any more, still settable because the pipeline that reads them is
 * still the one running. Hiding them the moment their replacement was written would take a
 * live dial away from whoever is using it; dropping them onto a node that ignores them
 * would be worse. They leave with the commit that puts the replacement live.
 */
export default function RetiredParams({ params }: RetiredParamsProps) {
  if (params.length === 0) return null;

  return (
    <section className="space-y-3 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 p-4">
      <div>
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300">
          On their way out
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Still read by the pipeline running today. The step that replaces each
          of them is written but not live yet, so setting one here still changes
          recommendations. They are removed once that step goes live.
        </p>
      </div>

      {params.map((param) => (
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
          <p className="text-xs italic text-amber-700 dark:text-amber-300">
            {param.reason}
          </p>
        </div>
      ))}
    </section>
  );
}
