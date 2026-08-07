export type ProxyResponse<T> = {
  status: number;
  data: T;
  ok: boolean;
};

export type LidarrPaginatedResponse<T> = {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: T[];
};

export type LidarrArtist = {
  id: number;
  artistName: string;
  foreignArtistId: string;
  monitored: boolean;
  folder: string;
};

export type LidarrAlbumStatistics = {
  trackFileCount: number;
  totalTrackCount: number;
  percentOfTracks: number;
};

export type LidarrAlbum = {
  id: number;
  title: string;
  foreignAlbumId: string;
  monitored: boolean;
  statistics?: LidarrAlbumStatistics;
  artist: {
    id: number;
    artistName: string;
    foreignArtistId: string;
  };
};

export type LidarrQueueItem = {
  id: number;
  status: string;
  title: string;
  size: number;
  sizeleft: number;
  trackedDownloadStatus: string;
  artist: { artistName: string };
  album: { title: string; foreignAlbumId: string };
  quality: { quality: { name: string } };
};

export type LidarrWantedRecord = {
  id: number;
  title: string;
  foreignAlbumId: string;
  artist: { artistName: string };
};

export type LidarrHistoryRecord = {
  id: number;
  albumId: number;
  eventType: number;
  date: string;
  downloadId: string;
  data: Record<string, string>;
  artist: { id: number; artistName: string };
  album: { id: number; title: string; foreignAlbumId: string };
};

export type LidarrManualImportItem = {
  path: string;
  name: string;
  albumReleaseId: number;
  tracks: { id: number; title: string; trackNumber: string }[];
  rejections: { reason: string }[];
  quality: { quality: { name: string } };
  indexerFlags: number;
  downloadId: string;
  disableReleaseSwitching: boolean;
  artist: { id: number };
  album: { id: number };
};

export type LidarrSchemaField = {
  name: string;
  value: unknown;
};

export type LidarrIndexerResource = {
  id: number;
  name: string;
  implementation: string;
  fields: LidarrSchemaField[];
};

export type LidarrDownloadClientResource = {
  id: number;
  name: string;
  implementation: string;
  fields: LidarrSchemaField[];
};

export type LidarrQualityProfile = {
  id: number;
  name: string;
};

export type LidarrMetadataProfile = {
  id: number;
  name: string;
};

export type LidarrRootFolder = {
  id: number;
  path: string;
};

export type LidarrCommand = {
  id: number;
  name: string;
  status: string;
};

/** Extracts a human-readable error message from Lidarr's error responses (array or object format) */
export function extractLidarrError(data: unknown): string {
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (first && typeof first === "object" && "errorMessage" in first) {
      return String(first.errorMessage);
    }
  }
  if (data && typeof data === "object" && "message" in data) {
    return String(data.message);
  }
  return JSON.stringify(data);
}
