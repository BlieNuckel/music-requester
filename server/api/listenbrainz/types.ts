export type ListenBrainzSimilarArtist = {
  artist_mbid: string;
  name: string;
  comment: string;
  type: string | null;
  gender: string | null;
  score: number;
  reference_mbid: string;
};

/** One entry of the sitewide fresh-releases feed, trimmed to what we use. */
export type ListenBrainzFreshRelease = {
  artistName: string;
  artistMbids: string[];
  releaseName: string;
  releaseDate: string | null;
  releaseGroupMbid: string;
  primaryType: string | null;
  secondaryType: string | null;
};
