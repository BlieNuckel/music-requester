import { useMemo } from "react";
import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";
import type { ReleaseGroup } from "../types";

export interface SimilarAlbum {
  mbid: string;
  title: string;
  artistName: string;
  artistMbid: string;
  year: string;
  score: number;
  reasons: ("tag" | "artist")[];
}

interface SimilarAlbumsResponse {
  albums: SimilarAlbum[];
}

/**
 * The similar-albums endpoint synthesizes its results rather than reading a discography,
 * so it carries no MusicBrainz release metadata. Shaping it as a `ReleaseGroup` anyway is
 * what lets these render through the same card as every other album list, with the same
 * library badge, context menu and navigation.
 */
function toReleaseGroup(album: SimilarAlbum): ReleaseGroup {
  return {
    id: album.mbid,
    score: album.score,
    title: album.title,
    "primary-type": "Album",
    "first-release-date": album.year,
    "artist-credit": [
      {
        name: album.artistName,
        artist: { id: album.artistMbid, name: album.artistName },
      },
    ],
  };
}

async function fetchSimilarAlbums({
  key,
  signal,
}: FetchContext): Promise<SimilarAlbumsResponse> {
  const res = await fetch(
    `/api/similar-albums?mbid=${encodeURIComponent(key)}`,
    { signal }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to load similar albums");
  }
  return res.json();
}

export default function useSimilarAlbums(mbid: string | null | undefined) {
  const { data, loading, error } = useAsyncData(
    mbid ?? null,
    fetchSimilarAlbums
  );

  const albums = useMemo(
    () => (data?.albums ?? []).map(toReleaseGroup),
    [data]
  );

  return { albums, loading, error };
}
