import { useMemo } from "react";
import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";

export type SimilarArtist = {
  name: string;
  mbid: string;
  imageUrl: string;
  match?: number;
};

async function fetchSimilarArtists({
  key,
  signal,
}: FetchContext): Promise<SimilarArtist[]> {
  const res = await fetch(key, { signal });
  if (!res.ok) {
    throw new Error("Failed to fetch similar artists");
  }
  const data: { artists: SimilarArtist[] } = await res.json();
  return data.artists || [];
}

export default function useSimilarArtists(
  artistName: string | undefined,
  excludeMbid?: string
) {
  const key = artistName
    ? `/api/lastfm/similar?artist=${encodeURIComponent(artistName)}`
    : null;
  const { data, loading, error } = useAsyncData(key, fetchSimilarArtists);

  const artists = useMemo(
    () =>
      (data ?? [])
        .filter((a) => !excludeMbid || a.mbid !== excludeMbid)
        .slice(0, 10),
    [data, excludeMbid]
  );

  return { artists, loading, error };
}
