import useAsyncData from "@/hooks/useAsyncData";
import type { FlowId, RecommenderGraph } from "@shared/recommenderGraph";

/**
 * One flow's shape, without its knobs. Static and the same for everyone, so it is fetched
 * when a chart is actually opened and never refreshed: it changes when the code changes.
 *
 * `enabled` is what keeps a trace modal that is closed from fetching a chart nobody asked to
 * see — five cards on Discover each hold one.
 */
export function useFlowShape(flow: FlowId, enabled = true) {
  return useAsyncData<RecommenderGraph>(
    enabled ? `recommender-flow:${flow}` : null,
    async ({ signal }) => {
      const res = await fetch(`/api/recommendations/graph/${flow}`, { signal });
      if (!res.ok) throw new Error("Could not load the recommender graph");
      return (await res.json()) as RecommenderGraph;
    }
  );
}
