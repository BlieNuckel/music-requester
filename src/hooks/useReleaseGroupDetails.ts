import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";
import type { AlbumDetails } from "../types";

interface AlbumDetailsResponse {
  album: AlbumDetails;
}

async function fetchAlbumDetails({
  key,
  signal,
}: FetchContext): Promise<AlbumDetailsResponse> {
  const res = await fetch(`/api/musicbrainz/album/${key}`, { signal });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to load album");
  }
  return res.json();
}

export default function useReleaseGroupDetails(mbid: string | undefined) {
  const { data, loading, error } = useAsyncData(
    mbid ?? null,
    fetchAlbumDetails
  );

  return {
    album: data?.album ?? null,
    loading,
    error,
  };
}
