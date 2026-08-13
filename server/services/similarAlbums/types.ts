/** Which recipe produced a candidate. Both legs agreeing is the strongest signal we have. */
export type SimilarAlbumReason = "tag" | "artist";

/** The album a similarity request is anchored on. */
export type SeedAlbum = {
  mbid: string;
  title: string;
  artistName: string;
  artistMbid: string;
};

/**
 * One album a leg proposed, before dedup and ranking. `mbid` is empty when the
 * source didn't carry one — those are resolved against MusicBrainz later, and
 * only for candidates that survive ranking.
 */
export type AlbumCandidate = {
  title: string;
  artistName: string;
  artistMbid: string;
  mbid: string;
  /** Normalized to 0..1 within its own leg, so the two legs are comparable. */
  score: number;
  reason: SimilarAlbumReason;
};

/** A candidate after the legs are merged, carrying each leg's best score for it. */
export type MergedCandidate = {
  key: string;
  title: string;
  artistName: string;
  artistMbid: string;
  mbid: string;
  tagScore: number;
  artistScore: number;
  score: number;
  reasons: SimilarAlbumReason[];
};

export type SimilarAlbum = {
  mbid: string;
  title: string;
  artistName: string;
  artistMbid: string;
  /** Empty unless the album went through MusicBrainz — Last.fm carries no release date. */
  year: string;
  score: number;
  reasons: SimilarAlbumReason[];
};
