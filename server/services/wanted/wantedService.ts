import type { WantedItem } from "../../db/index";
import {
  deleteWantedItem,
  findWantedItem,
  insertWantedItem,
  listWantedItems,
} from "../../db/wantedItems";
import { getReleaseGroupById } from "../../api/musicbrainz/releaseGroups";
import { createLogger } from "../../logger";

type AddWantedResult =
  { status: "added"; id: number } | { status: "already_wanted"; id: number };

type RemoveWantedResult = { status: "removed" } | { status: "not_found" };

const log = createLogger("wanted");

async function resolveAlbumInfo(
  albumMbid: string
): Promise<{ artistName: string; albumTitle: string }> {
  const info = await getReleaseGroupById(albumMbid);
  if (!info) {
    throw new Error(
      `Could not resolve release group ${albumMbid} on MusicBrainz`
    );
  }
  return info;
}

export async function addWantedItem(
  userId: number,
  albumMbid: string
): Promise<AddWantedResult> {
  const existing = await findWantedItem(userId, albumMbid);
  if (existing) {
    return { status: "already_wanted", id: existing.id };
  }

  const { artistName, albumTitle } = await resolveAlbumInfo(albumMbid);
  const saved = await insertWantedItem({
    userId,
    albumMbid,
    artistName,
    albumTitle,
  });
  log.info(`User ${userId} added "${albumTitle}" to wanted list`);

  return { status: "added", id: saved.id };
}

export async function removeWantedItem(
  userId: number,
  albumMbid: string
): Promise<RemoveWantedResult> {
  const item = await findWantedItem(userId, albumMbid);
  if (!item) {
    return { status: "not_found" };
  }

  await deleteWantedItem(item);
  log.info(`User ${userId} removed "${item.album_title}" from wanted list`);

  return { status: "removed" };
}

export async function getWantedItems(userId: number): Promise<WantedItem[]> {
  return listWantedItems(userId);
}
