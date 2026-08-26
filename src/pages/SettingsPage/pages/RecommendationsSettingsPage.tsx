import { lazy, Suspense, useMemo, useState } from "react";
import { useSettings } from "@/context/useSettings";
import { useAutoSave } from "@/hooks/useAutoSave";
import { DEFAULT_PROMOTED_ALBUM } from "@/context/promotedAlbumDefaults";
import Skeleton from "@/components/Skeleton";
import SaveStatusIndicator from "../shared/SaveStatusIndicator";
import RecommenderListView from "../sections/recommendations/graph/RecommenderListView";
import RecommenderToolbar from "../sections/recommendations/graph/RecommenderToolbar";
import RetiredParams from "../sections/recommendations/graph/RetiredParams";
import { applyParamChange } from "@/components/recommenderGraph/paramCoupling";
import { RecommenderParamsContext } from "@/components/recommenderGraph/paramsContext";
import { useRecommenderGraph } from "../sections/recommendations/graph/useRecommenderGraph";
import { DEFAULT_LAYOUT } from "@/components/recommenderGraph/autoLayout";
import type { RecommenderView } from "../sections/recommendations/graph/RecommenderToolbar";
import type { FlowId } from "@shared/recommenderGraph";

/**
 * The canvas pulls in the flow library, which is a third of the app's bundle and is only
 * ever reached by an admin on this page.
 */
const RecommenderGraphCanvas = lazy(
  () => import("@/components/recommenderGraph/RecommenderGraphCanvas")
);

function LoadingState() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-[420px] w-full rounded-xl" />
    </div>
  );
}

export default function RecommendationsSettingsPage() {
  const { settings, isLoading, savePartialSettings } = useSettings();
  const { fields, saveStatus, saveError, updateField } = useAutoSave(
    settings,
    savePartialSettings
  );
  const { data: graph, loading, error } = useRecommenderGraph();
  const [view, setView] = useState<RecommenderView>("graph");
  const [flow, setFlow] = useState<FlowId>("spotlight");
  const [arrivedAt, setArrivedAt] = useState<string | null>(null);

  const config = fields.promotedAlbum ?? DEFAULT_PROMOTED_ALBUM;
  const params = useMemo(
    () => ({
      config,
      update: (
        key: Parameters<typeof applyParamChange>[1],
        value: Parameters<typeof applyParamChange>[2]
      ) => updateField("promotedAlbum", applyParamChange(config, key, value)),
      openFlow: (next: FlowId, node: string) => {
        setFlow(next);
        setArrivedAt(node);
      },
      arrivedAt,
    }),
    [config, updateField, arrivedAt]
  );

  if (isLoading || loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Recommendations
        </h2>
        <SaveStatusIndicator status={saveStatus} error={saveError} />
      </div>

      <RecommenderToolbar
        view={view}
        onViewChange={setView}
        flow={flow}
        onFlowChange={(next) => {
          setFlow(next);
          setArrivedAt(null);
        }}
        onReset={() =>
          updateField("promotedAlbum", { ...DEFAULT_PROMOTED_ALBUM })
        }
      />

      {error && (
        <p className="text-sm font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {graph && (
        <RecommenderParamsContext.Provider value={params}>
          {view === "graph" ? (
            <Suspense
              fallback={<Skeleton className="h-[420px] w-full rounded-xl" />}
            >
              <RecommenderGraphCanvas
                graph={graph}
                flow={flow}
                layout={DEFAULT_LAYOUT}
              />
            </Suspense>
          ) : (
            <RecommenderListView graph={graph} flow={flow} />
          )}
          <RetiredParams params={graph.retiredParams} />
        </RecommenderParamsContext.Provider>
      )}
    </div>
  );
}
