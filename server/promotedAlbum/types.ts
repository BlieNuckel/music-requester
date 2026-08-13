import type { AlbumLibraryInfo } from "../../shared/albumLibrary";

/**
 * Paced MusicBrainz lookups one carousel build may spend, shared by every pick and both
 * modes. MusicBrainz allows ~1 req/sec and the interactive lane preempts background work,
 * so an unbounded build can hold the queue — and the pollers behind it — for minutes.
 * Mutable on purpose: the budget is spent across several layers of the build.
 */
export type ResolutionBudget = { remaining: number };

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

export type WithinTasteResult = {
  mode: "within_taste";
  album: PromotedAlbumInfo;
  tag: string;
  inLibrary: boolean;
  library: AlbumLibraryInfo | null;
  trace: WithinTasteTrace;
};

export type ExploreResult = {
  mode: "explore";
  album: PromotedAlbumInfo;
  seedArtist: string;
  newGenres: string[];
  inLibrary: boolean;
  library: AlbumLibraryInfo | null;
  trace: ExploreTrace;
};

export type PromotedAlbumEntry = WithinTasteResult | ExploreResult;

/** A built recommendation plus the key used for cross-shuffle anti-repeat. */
export type BuiltAlbum = {
  result: PromotedAlbumEntry;
  rememberKey: string;
};

export type PromotedAlbumResult = PromotedAlbumEntry | null;
