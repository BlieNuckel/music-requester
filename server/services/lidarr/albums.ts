import { lidarrGet } from "../../api/lidarr/get";
import type { LidarrAlbum } from "../../api/lidarr/types";
import { LIBRARY_SNAPSHOT_TTL_MS } from "./cacheTtl";
import { createSnapshotCache } from "../../utils/snapshotCache";

type AlbumsResult =
  | { ok: false; error: string; status: number }
  | { ok: true; data: LidarrAlbum[] };

async function loadMonitoredAlbums(): Promise<AlbumsResult> {
  const result = await lidarrGet<LidarrAlbum[]>("/album");

  if (!result.ok) {
    return {
      ok: false,
      error: "Failed to fetch albums",
      status: result.status,
    };
  }

  return { ok: true, data: result.data.filter((album) => album.monitored) };
}

const snapshot = createSnapshotCache({
  load: loadMonitoredAlbums,
  ttlMs: LIBRARY_SNAPSHOT_TTL_MS,
  shouldCache: (result: AlbumsResult) => result.ok,
});

/**
 * The monitored-album snapshot. `/album` returns a row per album of every
 * tracked artist's discography, so this is the heaviest Lidarr read in the app
 * and the one the spotlight pays on every cold pick.
 */
export function getMonitoredAlbums(): Promise<AlbumsResult> {
  return snapshot.get();
}

export function invalidateMonitoredAlbums(): void {
  snapshot.invalidate();
}
