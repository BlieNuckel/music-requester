import { getConfigValue } from "../../config";
import { lidarrGet } from "../../api/lidarr/get";
import { lidarrPost } from "../../api/lidarr/post";
import { lidarrPut } from "../../api/lidarr/put";
import {
  type LidarrAlbum,
  type LidarrArtist,
  type LidarrCommand,
  extractLidarrError,
} from "../../api/lidarr/types";
import { AsyncLock } from "../../api/asyncLock";
import { invalidateLidarrCaches } from "./invalidate";
import { createLogger } from "../../logger";

type AddAlbumOptions = {
  /** Queue a Lidarr AlbumSearch as part of the add. */
  search?: boolean;
};

const log = createLogger("lidarr-helpers");
const upsertLock = new AsyncLock();

const REFRESH_POLL_INTERVAL_MS = 1000;
const REFRESH_MAX_WAIT_MS = 30000;
const ALBUM_TRACKS_MAX_WAIT_MS = 60000;

export async function waitForArtistRefresh(): Promise<void> {
  const deadline = Date.now() + REFRESH_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    const result = await lidarrGet<LidarrCommand[]>("/command");
    const running = result.data.filter(
      (cmd) =>
        cmd.name === "RefreshArtist" &&
        (cmd.status === "queued" || cmd.status === "started")
    );

    if (running.length === 0) {
      log.info("Artist refresh completed");
      return;
    }

    log.info(`Waiting for ${running.length} RefreshArtist command(s)...`);
    await new Promise((resolve) =>
      setTimeout(resolve, REFRESH_POLL_INTERVAL_MS)
    );
  }

  log.warn(
    `Artist refresh did not complete within ${REFRESH_MAX_WAIT_MS}ms, continuing`
  );
}

function albumHasTracks(album: LidarrAlbum | undefined): boolean {
  if (!album) {
    return false;
  }

  if ((album.statistics?.totalTrackCount ?? 0) > 0) {
    return true;
  }

  return (album.releases ?? []).some(
    (release) => (release.trackCount ?? 0) > 0
  );
}

/**
 * A just-added album has no releases and no tracks until Lidarr's refresh runs,
 * and `/manualimport` can only match files against tracks that already exist.
 * Scanning too early makes every file come back unmatched.
 */
export async function waitForAlbumTracks(albumId: number): Promise<boolean> {
  const deadline = Date.now() + ALBUM_TRACKS_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    const result = await lidarrGet<LidarrAlbum>(`/album/${albumId}`);

    if (albumHasTracks(result.data)) {
      return true;
    }

    log.info(`Waiting for Lidarr to populate tracks for album ${albumId}...`);
    await new Promise((resolve) =>
      setTimeout(resolve, REFRESH_POLL_INTERVAL_MS)
    );
  }

  log.warn(
    `Album ${albumId} still has no tracks after ${ALBUM_TRACKS_MAX_WAIT_MS}ms, continuing`
  );
  return false;
}

export const getAlbumByMbid = async (albumMbid: string) => {
  const result = await lidarrGet<LidarrAlbum[]>("/album/lookup", {
    term: `lidarr:${albumMbid}`,
  });

  if (result.status !== 200 || !result.data?.length) {
    throw new Error("Album not found");
  }
  return result.data[0];
};

const addAlbumToLidarr = async (
  albumMbid: string,
  artist: LidarrArtist,
  search: boolean
) => {
  const album = await getAlbumByMbid(albumMbid);

  const addAlbumResult = await lidarrPost<LidarrAlbum>("/album", {
    ...album,
    artist,
    monitored: true,
    addOptions: { searchForNewAlbum: search },
  });

  if (addAlbumResult.status >= 300) {
    const errorMsg = extractLidarrError(addAlbumResult.data);

    // If Lidarr says "already added", fetch all albums and find it
    if (
      errorMsg.toLowerCase().includes("already") &&
      errorMsg.toLowerCase().includes("added")
    ) {
      const allAlbumsResult = await lidarrGet<LidarrAlbum[]>("/album");
      const existingAlbum = allAlbumsResult.data.find(
        (a) => a.foreignAlbumId === albumMbid
      );

      if (existingAlbum) {
        return existingAlbum;
      }
    }

    throw new Error(`Failed to add album: ${errorMsg}`);
  }

  invalidateLidarrCaches();
  return addAlbumResult.data;
};

const addArtistToLidarr = async (artistMbid: string) => {
  const qualityProfileId = getConfigValue("lidarrQualityProfileId");
  const metadataProfileId = getConfigValue("lidarrMetadataProfileId");
  const rootFolderPath = getConfigValue("lidarrRootFolderPath");

  const artistLookup = await lidarrGet<LidarrArtist[]>("/artist/lookup", {
    term: `lidarr:${artistMbid}`,
  });

  if (!artistLookup.data?.length) {
    throw new Error("Artist not found in Lidarr lookup");
  }

  const addArtistResult = await lidarrPost<LidarrArtist>("/artist", {
    ...artistLookup.data[0],
    qualityProfileId,
    metadataProfileId,
    rootFolderPath,
    monitored: true,
    monitorNewItems: "none",
    addOptions: { monitor: "existing", monitored: true },
  });

  if (!addArtistResult.ok) {
    throw new Error(
      `Failed to add artist: ${extractLidarrError(addArtistResult.data)}`
    );
  }

  await waitForArtistRefresh();

  invalidateLidarrCaches();
  return addArtistResult.data;
};

export const getOrAddArtist = async (artistMbid: string) => {
  return upsertLock.acquire(`artist:${artistMbid}`, async () => {
    const artistsResult = await lidarrGet<LidarrArtist[]>("/artist");
    const artist = artistsResult.data.find(
      (a) => a.foreignArtistId === artistMbid
    );

    if (artist) {
      return artist;
    }

    return await addArtistToLidarr(artistMbid);
  });
};

/**
 * Adds the album to Lidarr if it is missing. Defaults to *not* searching: the
 * manual-import flow already has the files, and a search there makes Lidarr
 * grab a second copy alongside them. Callers that want a download ask for it.
 */
export const getOrAddAlbum = async (
  albumMbid: string,
  artist: LidarrArtist,
  options: AddAlbumOptions = {}
) => {
  return upsertLock.acquire(`album:${albumMbid}`, async () => {
    // Check all albums in Lidarr, not just this artist's albums
    // This prevents "already added" errors when the album exists under a different artist
    const allAlbumsResult = await lidarrGet<LidarrAlbum[]>("/album");
    const existingAlbum = allAlbumsResult.data.find(
      (a) => a.foreignAlbumId === albumMbid
    );

    if (existingAlbum) {
      return { wasAdded: false, album: existingAlbum };
    }

    return {
      wasAdded: true,
      album: await addAlbumToLidarr(albumMbid, artist, options.search ?? false),
    };
  });
};

export const removeAlbum = async (albumMbid: string, artistMbid: string) => {
  const artistsResult = await lidarrGet<LidarrArtist[]>("/artist");
  const artist = artistsResult.data.find(
    (a) => a.foreignArtistId === artistMbid
  );

  if (!artist) {
    return { artistInLibrary: false } as const;
  }

  const allAlbumsResult = await lidarrGet<LidarrAlbum[]>("/album");
  const album = allAlbumsResult.data.find(
    (a) => a.foreignAlbumId === albumMbid
  );

  if (!album) {
    return { artistInLibrary: true, albumInLibrary: false } as const;
  }

  if (!album.monitored) {
    return {
      artistInLibrary: true,
      albumInLibrary: true,
      alreadyUnmonitored: true,
    } as const;
  }

  const result = await lidarrPut("/album/monitor", {
    albumIds: [album.id],
    monitored: false,
  });

  if (!result.ok) {
    throw new Error("Failed to unmonitor album");
  }

  invalidateLidarrCaches();
  return {
    artistInLibrary: true,
    albumInLibrary: true,
    alreadyUnmonitored: false,
  } as const;
};
