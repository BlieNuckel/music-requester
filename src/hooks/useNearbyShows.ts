import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";
import type { NearbyShowsData } from "@/types";

async function fetchNearbyShows({
  signal,
}: FetchContext): Promise<NearbyShowsData> {
  const res = await fetch("/api/live/nearby", { signal });
  if (!res.ok) throw new Error("Failed to fetch nearby shows");
  return res.json();
}

export default function useNearbyShows() {
  const { data, loading, error } = useAsyncData<NearbyShowsData>(
    "nearby-shows",
    fetchNearbyShows
  );
  return { shows: data?.events ?? [], loading, error };
}
