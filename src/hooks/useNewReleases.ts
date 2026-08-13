import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";
import type { NewReleasesData } from "@/types";

async function fetchNewReleases({
  signal,
}: FetchContext): Promise<NewReleasesData> {
  const res = await fetch("/api/discover/new-releases", { signal });
  if (!res.ok) throw new Error("Failed to fetch new releases");
  return res.json();
}

export default function useNewReleases() {
  const { data, loading, error } = useAsyncData(
    "new-releases",
    fetchNewReleases
  );
  return { newReleases: data, loading, error };
}
