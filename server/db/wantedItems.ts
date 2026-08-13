import { getDataSource, WantedItem } from "./index";

function repo() {
  return getDataSource().getRepository(WantedItem);
}

export async function findWantedItem(
  userId: number,
  albumMbid: string
): Promise<WantedItem | null> {
  return repo().findOne({ where: { user_id: userId, album_mbid: albumMbid } });
}

export async function listWantedItems(userId: number): Promise<WantedItem[]> {
  return repo().find({
    where: { user_id: userId },
    order: { created_at: "DESC" },
  });
}

export async function insertWantedItem(item: {
  userId: number;
  albumMbid: string;
  artistName: string;
  albumTitle: string;
}): Promise<WantedItem> {
  const repository = repo();
  return repository.save(
    repository.create({
      user_id: item.userId,
      album_mbid: item.albumMbid,
      artist_name: item.artistName,
      album_title: item.albumTitle,
    })
  );
}

export async function deleteWantedItem(item: WantedItem): Promise<void> {
  await repo().remove(item);
}
