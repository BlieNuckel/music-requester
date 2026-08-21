import { lidarrGet } from "../../api/lidarr/get";
import { lidarrPost } from "../../api/lidarr/post";
import type {
  LidarrCommand,
  LidarrManualImportItem,
  LidarrManualImportItemRaw,
} from "../../api/lidarr/types";
import { createLogger } from "../../logger";
import {
  getAlbumByMbid,
  getOrAddArtist,
  getOrAddAlbum,
  waitForAlbumTracks,
} from "./helpers";

const log = createLogger("lidarr-import");

export const ALLOWED_EXTENSIONS = [
  ".flac",
  ".mp3",
  ".ogg",
  ".wav",
  ".m4a",
  ".aac",
];

const COMMAND_POLL_INTERVAL_MS = 1000;
const COMMAND_MAX_WAIT_MS = 120000;
const FAILED_COMMAND_STATUSES = ["failed", "aborted", "cancelled", "orphaned"];

type ScanResult =
  | { ok: false; error: string; status: number }
  | {
      ok: true;
      artistId: number;
      albumId: number;
      items: LidarrManualImportItem[];
    };

/** A file Lidarr cannot import, and what it is missing. */
export type ImportProblem = { path: string; reason: string };

export type ConfirmResult =
  { ok: true; pending: boolean } | { ok: false; error: string };

/**
 * Narrows a raw `/manualimport` item to the fields we actually use. The client
 * posts these items back verbatim on confirm, so anything kept here is paid for
 * twice over the wire.
 */
export function toManualImportItem(
  raw: LidarrManualImportItemRaw
): LidarrManualImportItem {
  return {
    id: raw.id,
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
    quality: raw.quality,
    releaseGroup: raw.releaseGroup,
    indexerFlags: raw.indexerFlags,
    downloadId: raw.downloadId,
    disableReleaseSwitching: raw.disableReleaseSwitching,
    artist: raw.artist ? { id: raw.artist.id } : undefined,
    album: raw.album ? { id: raw.album.id } : undefined,
  };
}

/**
 * Re-runs Lidarr's identification with the artist and album the user picked as
 * overrides. The plain scan has to guess the album from file tags, so thinly
 * tagged files come back with no release and no tracks — this is the same
 * update Lidarr's own interactive import posts when you choose an album by hand.
 */
async function identifyItems(
  items: LidarrManualImportItemRaw[],
  artistId: number,
  albumId: number
): Promise<LidarrManualImportItemRaw[]> {
  const payload = items.map((item) => ({
    id: item.id,
    path: item.path,
    name: item.name,
    artistId,
    albumId,
    quality: item.quality,
    releaseGroup: item.releaseGroup,
    indexerFlags: item.indexerFlags ?? 0,
    downloadId: item.downloadId ?? "",
    additionalFile: false,
    replaceExistingFiles: false,
    disableReleaseSwitching: false,
  }));

  const result = await lidarrPost<LidarrManualImportItemRaw[]>(
    "/manualimport",
    payload
  );

  if (!result.ok || !result.data?.length) {
    log.warn("Re-identification failed, falling back to the raw scan", {
      status: result.status,
    });
    return items;
  }

  return result.data;
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
  const { album } = await getOrAddAlbum(albumMbid, artist, { search: false });

  await waitForAlbumTracks(album.id);

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

  const identified = await identifyItems(scanResult.data, artist.id, album.id);

  return {
    ok: true,
    artistId: artist.id,
    albumId: album.id,
    items: identified.map(toManualImportItem),
  };
}

/**
 * Lidarr's own interactive-import rule: a row needs an artist, an album, a
 * release, a track match and a known quality. Posting anything else makes the
 * ManualImport command throw on a zero id or reject the file as Unknown
 * quality, long after `POST /command` answered that it queued the work.
 */
export function findImportProblems(
  items: LidarrManualImportItem[]
): ImportProblem[] {
  return items.flatMap((item) => {
    const missing: string[] = [];

    if (!item.artist?.id) missing.push("artist");
    if (!item.album?.id) missing.push("album");
    if (!item.albumReleaseId) missing.push("album release");
    if (!item.tracks?.length) missing.push("track match");
    if (!item.quality?.quality?.id) missing.push("quality");

    if (!missing.length) {
      return [];
    }

    return [
      {
        path: item.path,
        reason: `Lidarr could not determine: ${missing.join(", ")}`,
      },
    ];
  });
}

export function buildConfirmPayload(items: LidarrManualImportItem[]) {
  return items.map((item) => ({
    path: item.path,
    artistId: item.artist?.id,
    albumId: item.album?.id,
    albumReleaseId: item.albumReleaseId,
    trackIds: Array.isArray(item.tracks) ? item.tracks.map((t) => t.id) : [],
    quality: item.quality,
    releaseGroup: item.releaseGroup,
    indexerFlags: item.indexerFlags ?? 0,
    downloadId: item.downloadId ?? "",
    disableReleaseSwitching: item.disableReleaseSwitching ?? false,
  }));
}

/**
 * `POST /command` answers as soon as the command is queued, so its 201 says
 * nothing about whether the files were imported. Poll until Lidarr is done.
 */
async function awaitCommand(commandId: number): Promise<ConfirmResult> {
  const deadline = Date.now() + COMMAND_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    const result = await lidarrGet<LidarrCommand>(`/command/${commandId}`);
    const command = result.data;

    if (command?.status === "completed") {
      if (command.result === "unsuccessful") {
        return {
          ok: false,
          error:
            command.exception ??
            command.message ??
            "Lidarr could not import the files",
        };
      }
      return { ok: true, pending: false };
    }

    if (command && FAILED_COMMAND_STATUSES.includes(command.status)) {
      return {
        ok: false,
        error:
          command.exception ??
          command.message ??
          `Lidarr import ${command.status}`,
      };
    }

    await new Promise((resolve) =>
      setTimeout(resolve, COMMAND_POLL_INTERVAL_MS)
    );
  }

  log.warn("Manual import command still running, stopped waiting", {
    commandId,
  });
  return { ok: true, pending: true };
}

export async function confirmImport(
  items: LidarrManualImportItem[]
): Promise<ConfirmResult> {
  const files = buildConfirmPayload(items);

  const result = await lidarrPost<LidarrCommand>("/command", {
    name: "ManualImport",
    files,
    importMode: "move",
  });

  if (!result.ok || !result.data?.id) {
    return { ok: false, error: "Lidarr rejected the manual import command" };
  }

  return awaitCommand(result.data.id);
}
