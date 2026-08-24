import useAsyncData from "@/hooks/useAsyncData";
import type { RecommenderGraph } from "@shared/recommenderGraph";

/**
 * The declared pipeline. Static and identical for every admin, so it is fetched once and
 * never refreshed: it changes when the code changes, not when settings do.
 */
export function useRecommenderGraph() {
  return useAsyncData<RecommenderGraph>(
    "recommender-graph",
    async ({ signal }) => {
      const res = await fetch("/api/recommendations/graph", { signal });
      if (!res.ok) throw new Error("Could not load the recommender graph");
      return (await res.json()) as RecommenderGraph;
    }
  );
}
