export type MusicBrainzReleaseGroup = {
  id: string;
  score: number;
  title: string;
  "primary-type": string;
  "first-release-date": string;
  "artist-credit": Array<{
    name: string;
    artist: {
      id: string;
      name: string;
    };
  }>;
  "secondary-types"?: string[];
};

export type MusicBrainzSearchResponse = {
  "release-groups": MusicBrainzReleaseGroup[];
  count: number;
  offset: number;
};

export type MusicBrainzArtist = {
  id: string;
  name: string;
  score?: number;
  disambiguation?: string;
  type?: string;
  country?: string;
};

export type MusicBrainzArtistSearchResponse = {
  artists: MusicBrainzArtist[];
};

export type ArtistInfo = {
  mbid: string;
  name: string;
  score?: number;
  disambiguation?: string;
  type?: string;
  country?: string;
};

export type MusicBrainzTrack = {
  position: number;
  title: string;
  length: number | null;
  recording: { title: string };
};

export type MusicBrainzMedium = {
  position: number;
  format: string;
  title: string;
  tracks: MusicBrainzTrack[];
};

export type MusicBrainzReleasesResponse = {
  releases: { media: MusicBrainzMedium[] }[];
};

export type ReleaseGroupSearchResult = {
  "release-groups": MusicBrainzReleaseGroup[];
  count: number;
  offset: number;
};

export type TrackMedia = {
  position: number;
  format: string;
  title: string;
  tracks: { position: number; title: string; length: number | null }[];
};

export type MusicBrainzRelease = {
  id: string;
  title: string;
  "release-group": {
    id: string;
    title: string;
    "first-release-date"?: string;
    "primary-type"?: string | null;
    "secondary-types"?: string[];
  };
};

export type ReleaseGroupInfo = {
  id: string;
  firstReleaseDate: string;
  primaryType: string | null;
  secondaryTypes: string[];
};

export type MusicBrainzLabelRelation = {
  type: string;
  direction: "forward" | "backward";
  ended: boolean;
  label: { id: string; name: string };
};

export type MusicBrainzLabelWithRels = {
  id: string;
  name: string;
  relations?: MusicBrainzLabelRelation[];
};

export type MusicBrainzLabelInfo = {
  label?: { id: string; name: string };
};

export type MusicBrainzReleaseWithLabels = {
  id: string;
  "label-info"?: MusicBrainzLabelInfo[];
};

export type MusicBrainzLabelReleasesResponse = {
  releases: MusicBrainzReleaseWithLabels[];
};
