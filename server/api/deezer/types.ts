export type DeezerArtist = {
  id: number;
  name: string;
  picture: string;
  picture_small: string;
  picture_medium: string;
  picture_big: string;
  picture_xl: string;
};

export type DeezerArtistSearchResponse = {
  data: DeezerArtist[];
  total: number;
};

export type DeezerTrack = {
  id: number;
  title: string;
  preview: string;
  artist: { id: number; name: string };
};

export type DeezerTrackSearchResponse = {
  data: DeezerTrack[];
  total: number;
};

export type DeezerAlbum = {
  id: number;
  title: string;
  release_date?: string;
  record_type?: string;
  explicit_lyrics?: boolean;
  cover?: string;
  cover_xl?: string;
  link?: string;
};

export type DeezerAlbumsResponse = {
  data: DeezerAlbum[];
  total: number;
  next?: string;
};

export type DeezerAlbumSearchResponse = {
  data: DeezerAlbum[];
  total: number;
};
