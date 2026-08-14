import { lidarrGet } from "../../api/lidarr/get";
import type { LidarrArtist } from "../../api/lidarr/types";
import { LIBRARY_SNAPSHOT_TTL_MS } from "./cacheTtl";
import { createSnapshotCache } from "../../utils/snapshotCache";

type ArtistListItem = { id: number; name: string; foreignArtistId: string };

type ArtistListResult =
  | { ok: false; error: string; status: number }
  | { ok: true; data: ArtistListItem[] };

async function loadArtistList(): Promise<ArtistListResult> {
  const result = await lidarrGet<LidarrArtist[]>("/artist");

  if (!result.ok) {
    return {
      ok: false,
      error: "Failed to fetch artists from Lidarr",
      status: result.status,
    };
  }

  return {
    ok: true,
    data: result.data.map((a) => ({
      id: a.id,
      name: a.artistName,
      foreignArtistId: a.foreignArtistId,
    })),
  };
}

const snapshot = createSnapshotCache({
  load: loadArtistList,
  ttlMs: LIBRARY_SNAPSHOT_TTL_MS,
  shouldCache: (result: ArtistListResult) => result.ok,
});

/**
 * The Lidarr artist list, cached because several read paths (Discover, the
 * spotlight, the artist picker) each pull the whole library on every request.
 * Library mutations call {@link invalidateArtistList}, so the TTL only has to
 * cover changes made in Lidarr itself.
 */
export function getArtistList(): Promise<ArtistListResult> {
  return snapshot.get();
}

export function invalidateArtistList(): void {
  snapshot.invalidate();
}
