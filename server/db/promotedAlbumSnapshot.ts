import { getDataSource } from "./index";
import { PromotedAlbumSnapshot } from "./entity/PromotedAlbumSnapshot";
import type { PromotedAlbumEntry } from "../promotedAlbum/types";

/** A stored carousel plus when it was built, in epoch milliseconds. */
export type StoredCarousel = {
  albums: PromotedAlbumEntry[];
  /** How many picks the build aimed for, which is not always how many it got. */
  targetCount: number;
  builtAt: number;
};

/**
 * Parse a stored document. A row whose JSON is unreadable, is not an array, or is empty
 * is reported as absent: the snapshot only exists to be better than nothing, so anything
 * it cannot vouch for is nothing.
 */
function parseStored(row: PromotedAlbumSnapshot): StoredCarousel | null {
  let albums: unknown;
  try {
    albums = JSON.parse(row.albums_json);
  } catch {
    return null;
  }
  if (!Array.isArray(albums) || albums.length === 0) return null;

  const builtAt = Date.parse(row.built_at);
  if (Number.isNaN(builtAt)) return null;

  return {
    albums: albums as PromotedAlbumEntry[],
    targetCount: row.target_count,
    builtAt,
  };
}

/** The last carousel this user was served, or null when there is none worth reading. */
export async function getPromotedAlbumSnapshot(
  userId: number
): Promise<StoredCarousel | null> {
  const repo = getDataSource().getRepository(PromotedAlbumSnapshot);
  const row = await repo.findOne({ where: { user_id: userId } });
  return row ? parseStored(row) : null;
}

/** Insert or replace this user's stored carousel. Empty batches are not worth storing. */
export async function savePromotedAlbumSnapshot(
  userId: number,
  albums: PromotedAlbumEntry[],
  targetCount: number,
  builtAt: number
): Promise<void> {
  if (albums.length === 0) return;

  const repo = getDataSource().getRepository(PromotedAlbumSnapshot);
  const existing = await repo.findOne({ where: { user_id: userId } });

  await repo.save(
    repo.create({
      ...(existing ?? {}),
      user_id: userId,
      albums_json: JSON.stringify(albums),
      target_count: targetCount,
      built_at: new Date(builtAt).toISOString(),
    })
  );
}
