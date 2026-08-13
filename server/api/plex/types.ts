export type PlexSection = {
  key: string;
  type: string;
  title: string;
};

export type PlexArtistMetadata = {
  title: string;
  viewCount: number;
  thumb: string;
  Genre: { tag: string }[];
};

export type PlexSectionsResponse = {
  MediaContainer: { Directory: PlexSection[] };
};

export type PlexArtistsResponse = {
  MediaContainer: { Metadata: PlexArtistMetadata[] };
};

export type PlexTrackMetadata = {
  ratingKey: string;
  title: string;
  viewCount?: number;
  parentRatingKey?: string;
  parentTitle?: string;
  grandparentRatingKey?: string;
  grandparentTitle?: string;
};

export type PlexTracksResponse = {
  MediaContainer: {
    totalSize?: number;
    Metadata?: PlexTrackMetadata[];
  };
};

export type PlexHistoryMetadata = {
  grandparentTitle?: string;
  grandparentThumb?: string;
  viewedAt: number;
};

export type PlexHistoryResponse = {
  MediaContainer: { Metadata?: PlexHistoryMetadata[] };
};

export type TopArtistsRange = "all" | "4weeks" | "6months" | "12months";

export type PlexTopArtist = {
  name: string;
  viewCount: number;
  thumb: string;
  genres: string[];
};

/** Plex `type` ids for the rateable music entities tunearr ingests. */
export type PlexRatingType = 9 | 10; // 9 = album, 10 = track

export type PlexRatedItemMetadata = {
  ratingKey: string;
  title: string;
  userRating?: number;
  parentTitle?: string;
  grandparentTitle?: string;
};

export type PlexRatedItemsResponse = {
  MediaContainer: {
    totalSize?: number;
    Metadata?: PlexRatedItemMetadata[];
  };
};

export type PlexRatedItem = {
  ratingKey: string;
  kind: "album" | "track";
  title: string;
  artist: string;
  /** Plex scale 0–10 (half-star = 1 unit). */
  rating: number;
};
