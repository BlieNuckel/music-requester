import { useEffect } from "react";
import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";
import type { AlbumLibraryInfo } from "@shared/albumLibrary";

export type TraceArtistTagContribution = {
  tagName: string;
  rawCount: number;
  weight: number;
};

export type TraceArtistEntry = {
  name: string;
  viewCount: number;
  picked: boolean;
  tagContributions: TraceArtistTagContribution[];
  /** Absent for artists known only from the legacy artist-level plays series. */
  distinctTracksPlayed?: number;
  topTrackShare?: number;
  distributionFactor?: number;
  /** Absent for artists with nothing rated. */
  ratingBreadth?: number;
  ratingMultiplier?: number;
  /** Absent until a catalogue capture has run for this user. */
  availableTracks?: number;
};

export type TraceWeightedTag = {
  name: string;
  weight: number;
  fromArtists: string[];
};

export type TraceAlbumPoolInfo = {
  page1Count: number;
  deepPage: number;
  deepPageCount: number;
  totalAfterDedup: number;
};

export type TraceSelectionReason =
  | "preferred_non_library"
  | "preferred_library"
  | "fallback_in_library"
  | "fallback_non_library"
  | "no_preference";

export type WithinTasteTrace = {
  kind: "within_taste";
  plexArtists: TraceArtistEntry[];
  weightedTags: TraceWeightedTag[];
  chosenTag: { name: string; weight: number };
  albumPool: TraceAlbumPoolInfo;
  selectionReason: TraceSelectionReason;
};

export type TraceSimilarArtist = {
  name: string;
  score: number;
  genres: string[];
  genreOverlap: number;
  isDifferentGenre: boolean;
  chosen: boolean;
};

export type ExploreTrace = {
  kind: "explore";
  seedArtist: string;
  seedGenres: string[];
  candidates: TraceSimilarArtist[];
  chosenArtist: string;
  chosenGenres: string[];
  newGenres: string[];
  selectionReason: TraceSelectionReason;
};

export type PersonalTrace = {
  kind: "personal";
  seedArtist: string;
  seedGenres: string[];
  candidates: TraceSimilarArtist[];
  chosenArtist: string;
  chosenGenres: string[];
  sharedGenres: string[];
  /** True when no neighbour was close enough and the pool fell back to the whole graph. */
  widened: boolean;
  selectionReason: TraceSelectionReason;
};

export type RecommendationTrace =
  WithinTasteTrace | ExploreTrace | PersonalTrace;

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
} & (
  | { mode: "within_taste"; tag: string; trace: WithinTasteTrace }
  | {
      mode: "explore";
      seedArtist: string;
      newGenres: string[];
      trace: ExploreTrace;
    }
  | {
      mode: "personal";
      seedArtist: string;
      sharedGenres: string[];
      trace: PersonalTrace;
    }
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
