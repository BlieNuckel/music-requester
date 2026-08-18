import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";
import type { LiveRosterSummary } from "@/types";

async function fetchLiveRoster({
  signal,
}: FetchContext): Promise<LiveRosterSummary> {
  const res = await fetch("/api/live/roster", { signal });
  if (!res.ok) throw new Error("Failed to load roster summary");
  return res.json();
}

/** Admin-only counts of followed artists per JamBase resolution state. */
export default function useLiveRoster(enabled: boolean) {
  const { data, loading, error } = useAsyncData<LiveRosterSummary>(
    enabled ? "live-roster" : null,
    fetchLiveRoster
  );
  return { roster: data, loading, error };
}
