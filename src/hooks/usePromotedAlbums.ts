import { useEffect } from "react";
import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";
import type { AlbumLibraryInfo } from "@shared/albumLibrary";
import type { RecommendationTrace } from "@shared/recommendationTrace";

export type PromotedAlbumInfo = {
  name: string;
  mbid: string;
  artistName: string;
  artistMbid: string;
  coverUrl: string;
  year: string;
};

export type PromotedAlbumData = {
  album: PromotedAlbumInfo;
  inLibrary: boolean;
  library: AlbumLibraryInfo | null;
  /** The run that produced this recommendation, which is what the trace view draws. */
  trace: RecommendationTrace;
} & (
  | { mode: "within_taste"; tag: string }
  | { mode: "explore"; seedArtist: string; newGenres: string[] }
  | { mode: "personal"; seedArtist: string; sharedGenres: string[] }
);

/**
 * `building` means the server has no taste profile for this user yet and is constructing
 * one off-request — an empty carousel that will fill in, as opposed to one that has
 * nothing to show.
 */
export type PromotedAlbumsResponse = {
  status: "ready" | "building";
  albums: PromotedAlbumData[];
};

/** How often to re-check while the profile is still being built. */
const BUILDING_POLL_MS = 15_000;

async function fetchPromotedAlbums({
  refresh,
  signal,
}: FetchContext): Promise<PromotedAlbumsResponse> {
  const url = refresh
    ? "/api/promoted-album?refresh=true"
    : "/api/promoted-album";
  const res = await fetch(url, { signal });

  if (!res.ok) {
    throw new Error("Failed to fetch promoted albums");
  }

  const data = await res.json();
  return {
    status: data?.status === "building" ? "building" : "ready",
    albums: Array.isArray(data?.albums) ? data.albums : [],
  };
}

export default function usePromotedAlbums() {
  const { data, loading, error, refresh } = useAsyncData(
    "promoted-albums",
    fetchPromotedAlbums
  );

  const building = data?.status === "building";

  useEffect(() => {
    if (!building) return;
    const timer = setInterval(() => void refresh(), BUILDING_POLL_MS);
    return () => clearInterval(timer);
  }, [building, refresh]);

  return {
    promotedAlbums: data?.albums ?? [],
    building,
    loading,
    error,
    refresh,
  };
}
