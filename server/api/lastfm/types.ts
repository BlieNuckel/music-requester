export type LastfmSimilarArtist = {
  name: string;
  mbid: string;
  match: string;
  image?: Array<{ "#text": string; size: string }>;
};

export type LastfmTag = {
  name: string;
  count: number;
};

export type LastfmTagArtist = {
  name: string;
  mbid: string;
  image?: Array<{ "#text": string; size: string }>;
};

export type LastfmSimilarResponse = {
  error?: number;
  message?: string;
  similarartists?: { artist: LastfmSimilarArtist[] };
};

export type LastfmTopTagsResponse = {
  error?: number;
  message?: string;
  toptags?: { tag: LastfmTag[] };
};

export type LastfmTagArtistsResponse = {
  error?: number;
  message?: string;
  topartists?: {
    artist: LastfmTagArtist[];
    "@attr"?: { page: string; totalPages: string };
  };
};

export type LastfmTagAlbum = {
  name: string;
  mbid: string;
  artist: { name: string; mbid: string };
  image?: Array<{ "#text": string; size: string }>;
};

export type LastfmTagAlbumsResponse = {
  error?: number;
  message?: string;
  albums?: {
    album: LastfmTagAlbum[];
    "@attr"?: { page: string; totalPages: string };
  };
};

export type LastfmAlbumTopTagsResponse = {
  error?: number;
  message?: string;
  toptags?: { tag: LastfmTag[] };
};

export type LastfmArtistAlbum = {
  name: string;
  mbid: string;
  playcount?: number;
  artist?: { name: string; mbid: string };
  image?: Array<{ "#text": string; size: string }>;
};

export type LastfmArtistTopAlbumsResponse = {
  error?: number;
  message?: string;
  topalbums?: {
    album: LastfmArtistAlbum[];
    "@attr"?: { artist: string };
  };
};
