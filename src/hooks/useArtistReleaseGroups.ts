import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";
import type { ReleaseGroup } from "../types";

interface ArtistReleaseGroupsResponse {
  releaseGroups: ReleaseGroup[];
}

async function fetchArtistReleaseGroups({
  key,
  signal,
}: FetchContext): Promise<ArtistReleaseGroupsResponse> {
  const res = await fetch(`/api/musicbrainz/artist/${key}/release-groups`, {
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to load discography");
  }
  return res.json();
}

export default function useArtistReleaseGroups(
  artistMbid: string | null | undefined
) {
  const { data, loading, error } = useAsyncData(
    artistMbid ?? null,
    fetchArtistReleaseGroups
  );

  return {
    releaseGroups: data?.releaseGroups ?? [],
    loading,
    error,
  };
}
