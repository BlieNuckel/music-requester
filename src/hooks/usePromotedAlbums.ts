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

export type RecommendationTrace = WithinTasteTrace | ExploreTrace;

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
);

async function fetchPromotedAlbums({
  refresh,
}: FetchContext): Promise<PromotedAlbumData[]> {
  const url = refresh
    ? "/api/promoted-album?refresh=true"
    : "/api/promoted-album";
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error("Failed to fetch promoted albums");
  }

  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export default function usePromotedAlbums() {
  const { data, loading, error, refresh } = useAsyncData(
    "promoted-albums",
    fetchPromotedAlbums
  );

  return { promotedAlbums: data ?? [], loading, error, refresh };
}
