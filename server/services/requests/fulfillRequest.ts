import { lidarrPost } from "../../api/lidarr/post";
import { lidarrPut } from "../../api/lidarr/put";
import { clearPromotedAlbumCache } from "../../promotedAlbum/getPromotedAlbum";
import { clearPromotedArtistsCache } from "../../promotedArtists/getPromotedArtists";
import {
  getAlbumByMbid,
  getOrAddArtist,
  getOrAddAlbum,
} from "../lidarr/helpers";
import { invalidateLidarrCaches } from "../lidarr/invalidate";

type FulfillResult =
  | { status: "success"; artistName: string; albumTitle: string }
  | { status: "already_monitored"; artistName: string; albumTitle: string };

export async function fulfillRequest(
  albumMbid: string
): Promise<FulfillResult> {
  const lookupAlbum = await getAlbumByMbid(albumMbid);
  const artistMbid = lookupAlbum.artist?.foreignArtistId;

  if (!artistMbid) {
    throw new Error("Could not determine artist from album lookup");
  }

  const artistName = lookupAlbum.artist?.artistName ?? "Unknown Artist";
  const albumTitle = lookupAlbum.title ?? "Unknown Album";

  const artist = await getOrAddArtist(artistMbid);
  const { wasAdded, album } = await getOrAddAlbum(albumMbid, artist);

  if (!wasAdded && album?.monitored) {
    return { status: "already_monitored", artistName, albumTitle };
  }

  if (!album.monitored) {
    const monitorResult = await lidarrPut("/album/monitor", {
      albumIds: [album.id],
      monitored: true,
    });

    if (!monitorResult.ok) {
      throw new Error("Failed to monitor album");
    }
  }

  await lidarrPost("/command", {
    name: "AlbumSearch",
    albumIds: [album.id],
  });

  invalidateLidarrCaches();
  clearPromotedAlbumCache();
  clearPromotedArtistsCache();

  return { status: "success", artistName, albumTitle };
}
