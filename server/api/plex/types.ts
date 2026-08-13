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

/**
 * An album row from a section listing. `leafCount` is Plex's track count for the album;
 * `childCount` is carried as a fallback because which of the two a given PMS version
 * populates on a section listing is not guaranteed.
 */
export type PlexAlbumMetadata = {
  ratingKey: string;
  title: string;
  leafCount?: number;
  childCount?: number;
  parentRatingKey?: string;
  parentTitle?: string;
};

export type PlexAlbumsResponse = {
  MediaContainer: {
    totalSize?: number;
    Metadata?: PlexAlbumMetadata[];
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
  parentRatingKey?: string;
  grandparentTitle?: string;
  grandparentRatingKey?: string;
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
  /** The album a rated track belongs to; absent on album ratings, which are the album. */
  albumKey?: string;
  /** `grandparentRatingKey` for a track, `parentRatingKey` for an album. */
  artistKey?: string;
  /** Plex scale 0–10 (half-star = 1 unit). */
  rating: number;
};
