import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";
import type { ArtistDetails } from "../types";

interface ArtistDetailsResponse {
  artist: ArtistDetails;
}

async function fetchArtistDetails({
  key,
  signal,
}: FetchContext): Promise<ArtistDetailsResponse> {
  const res = await fetch(`/api/musicbrainz/artist/${key}`, { signal });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to load artist");
  }
  return res.json();
}

export default function useArtistDetails(mbid: string | undefined) {
  const { data, loading, error } = useAsyncData(
    mbid ?? null,
    fetchArtistDetails
  );

  return {
    artist: data?.artist ?? null,
    loading,
    error,
  };
}
