import type { AlbumLibraryInfo } from "../../shared/albumLibrary";
import type { RecommendationTrace } from "../../shared/recommendationTrace";

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

export type PromotedAlbumInfo = {
  name: string;
  mbid: string;
  artistName: string;
  artistMbid: string;
  coverUrl: string;
  year: string;
};

/** What every recommendation carries, whichever source produced it. */
type PickedAlbumBase = {
  album: PromotedAlbumInfo;
  inLibrary: boolean;
  library: AlbumLibraryInfo | null;
};

export type WithinTasteResult = PickedAlbumBase & {
  mode: "within_taste";
  tag: string;
};

export type ExploreResult = PickedAlbumBase & {
  mode: "explore";
  seedArtist: string;
  newGenres: string[];
};

/**
 * A within-taste recommendation sourced from the user's own listening graph rather than from
 * a genre's global album chart. Carries the seeding artist instead of a tag, because that is
 * what actually produced it.
 */
export type PersonalResult = PickedAlbumBase & {
  mode: "personal";
  seedArtist: string;
  sharedGenres: string[];
};

/**
 * One recommendation as its source built it, before the run that produced it is attached.
 * A source no longer writes its own account of itself: the loop attaches the record of the
 * nodes that actually ran, which is the same story told once instead of three times.
 */
export type PickedAlbum = WithinTasteResult | ExploreResult | PersonalResult;

/** The record of the run that produced a recommendation, attached by the pick loop. */
type Traced = { trace: RecommendationTrace };

export type PromotedAlbumEntry =
  | (WithinTasteResult & Traced)
  | (ExploreResult & Traced)
  | (PersonalResult & Traced);

/** A built recommendation plus the key used for cross-shuffle anti-repeat. */
export type BuiltAlbum = {
  result: PickedAlbum;
  rememberKey: string;
};

/** The same, once the loop has attached the record of the run that produced it. */
export type TracedAlbum = {
  result: PromotedAlbumEntry;
  rememberKey: string;
};

export type PromotedAlbumResult = PromotedAlbumEntry | null;
