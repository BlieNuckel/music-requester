import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";
import type { LiveEventSummary } from "@/types";

export type LiveEventsFilter = "upcoming" | "going" | "dismissed" | "past";

type LiveEventsResponse = { events: LiveEventSummary[] };

const QUERIES: Record<LiveEventsFilter, string> = {
  upcoming: "",
  going: "?response=going",
  dismissed: "?response=dismissed",
  past: "?past=true",
};

async function fetchLiveEvents({
  key,
  signal,
}: FetchContext): Promise<LiveEventsResponse> {
  const filter = key.replace("live-events:", "") as LiveEventsFilter;
  const res = await fetch(`/api/live/events${QUERIES[filter]}`, { signal });
  if (!res.ok) throw new Error("Failed to fetch live events");
  return res.json();
}

export default function useLiveEvents(filter: LiveEventsFilter) {
  const { data, loading, error, refresh } = useAsyncData<LiveEventsResponse>(
    `live-events:${filter}`,
    fetchLiveEvents
  );
  return { events: data?.events ?? [], loading, error, refresh };
}
