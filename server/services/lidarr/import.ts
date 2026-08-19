import { lidarrGet } from "../../api/lidarr/get";
import { lidarrPost } from "../../api/lidarr/post";
import type {
  LidarrManualImportItem,
  LidarrManualImportItemRaw,
} from "../../api/lidarr/types";
import { getAlbumByMbid, getOrAddArtist, getOrAddAlbum } from "./helpers";

export const ALLOWED_EXTENSIONS = [
  ".flac",
  ".mp3",
  ".ogg",
  ".wav",
  ".m4a",
  ".aac",
];

type ScanResult =
  | { ok: false; error: string; status: number }
  | {
      ok: true;
      artistId: number;
      albumId: number;
      items: LidarrManualImportItem[];
    };

/**
 * Narrows a raw `/manualimport` item to the fields we actually use. The client
 * posts these items back verbatim on confirm, so anything kept here is paid for
 * twice over the wire.
 */
export function toManualImportItem(
  raw: LidarrManualImportItemRaw
): LidarrManualImportItem {
  return {
    path: raw.path,
    name: raw.name,
    albumReleaseId: raw.albumReleaseId,
    tracks: raw.tracks?.map((track) => ({
      id: track.id,
      title: track.title,
      trackNumber: track.trackNumber,
    })),
    rejections: raw.rejections?.map((rejection) => ({
      reason: rejection.reason,
    })),
    quality: raw.quality
      ? { quality: { name: raw.quality.quality.name } }
      : undefined,
    indexerFlags: raw.indexerFlags,
    downloadId: raw.downloadId,
    disableReleaseSwitching: raw.disableReleaseSwitching,
    artist: raw.artist ? { id: raw.artist.id } : undefined,
    album: raw.album ? { id: raw.album.id } : undefined,
  };
}

export async function scanUploadedFiles(
  albumMbid: string,
  uploadDir: string
): Promise<ScanResult> {
  const lookupAlbum = await getAlbumByMbid(albumMbid);
  const artistMbid = lookupAlbum.artist?.foreignArtistId;
  if (!artistMbid) {
    return {
      ok: false,
      error: "Could not determine artist from album lookup",
      status: 404,
    };
  }

  const artist = await getOrAddArtist(artistMbid);
  const { album } = await getOrAddAlbum(albumMbid, artist);

  const scanResult = await lidarrGet<LidarrManualImportItemRaw[]>(
    "/manualimport",
    {
      folder: uploadDir,
      artistId: artist.id,
      filterExistingFiles: true,
    }
  );

  if (!scanResult.ok) {
    return {
      ok: false,
      error: "Lidarr manual import scan failed",
      status: 502,
    };
  }

  if (!scanResult.data?.length) {
    return {
      ok: false,
      error:
        "Lidarr found no importable files. Make sure the import path is accessible to Lidarr.",
      status: 400,
    };
  }

  return {
    ok: true,
    artistId: artist.id,
    albumId: album.id,
    items: scanResult.data.map(toManualImportItem),
  };
}

export function buildConfirmPayload(items: LidarrManualImportItem[]) {
  return items.map((item) => ({
    path: item.path,
    artistId: item.artist?.id,
    albumId: item.album?.id,
    albumReleaseId: item.albumReleaseId,
    trackIds: Array.isArray(item.tracks) ? item.tracks.map((t) => t.id) : [],
    quality: item.quality,
    indexerFlags: item.indexerFlags ?? 0,
    downloadId: item.downloadId ?? "",
    disableReleaseSwitching: item.disableReleaseSwitching ?? false,
  }));
}

export async function confirmImport(items: LidarrManualImportItem[]) {
  const files = buildConfirmPayload(items);

  const result = await lidarrPost("/command", {
    name: "ManualImport",
    files,
    importMode: "move",
  });

  return result;
}
