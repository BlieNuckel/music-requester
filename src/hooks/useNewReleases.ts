import useAsyncData from "./useAsyncData";
import type { NewReleasesData } from "@/types";

async function fetchNewReleases(): Promise<NewReleasesData> {
  const res = await fetch("/api/discover/new-releases");
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
