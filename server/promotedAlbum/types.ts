import type { AlbumLibraryInfo } from "../../shared/albumLibrary";

/**
 * Paced MusicBrainz lookups one carousel build may spend, shared by every pick and both
 * modes. MusicBrainz allows ~1 req/sec and the interactive lane preempts background work,
 * so an unbounded build can hold the queue — and the pollers behind it — for minutes.
 * Mutable on purpose: the budget is spent across several layers of the build.
 */
export type ResolutionBudget = { remaining: number };

/** What a build knows about the local library, asked one MBID at a time. */
export type LibraryLookups = {
  artistInLibrary: (mbid: string) => boolean;
  albumLibrary: (mbid: string) => AlbumLibraryInfo | null;
};

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
  /** Absent for artists the windowed track fold holds no rows for. */
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

/**
 * How a recommendation drawn from the user's own similar-artist graph was reached: which of
 * their artists seeded it, which neighbours that seed offered, and which one the album came
 * from. Same stages as the explore trace, opposite side of the genre-overlap line.
 */
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
  /** True when every close neighbour was on the wrong side of the library preference. */
  relaxedPreference: boolean;
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

/**
 * A within-taste recommendation sourced from the user's own listening graph rather than from
 * a genre's global album chart. Carries the seeding artist instead of a tag, because that is
 * what actually produced it.
 */
export type PersonalResult = {
  mode: "personal";
  album: PromotedAlbumInfo;
  seedArtist: string;
  sharedGenres: string[];
  inLibrary: boolean;
  library: AlbumLibraryInfo | null;
  trace: PersonalTrace;
};

export type PromotedAlbumEntry =
  WithinTasteResult | ExploreResult | PersonalResult;

/** A built recommendation plus the key used for cross-shuffle anti-repeat. */
export type BuiltAlbum = {
  result: PromotedAlbumEntry;
  rememberKey: string;
};

export type PromotedAlbumResult = PromotedAlbumEntry | null;
