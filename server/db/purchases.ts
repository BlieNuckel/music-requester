import { getDataSource, Purchase } from "./index";

export type PurchaseInput = {
  userId: number;
  albumMbid: string;
  artistName: string;
  albumTitle: string;
  price: number;
  currency: string;
};

function repo() {
  return getDataSource().getRepository(Purchase);
}

export async function findPurchase(
  userId: number,
  albumMbid: string
): Promise<Purchase | null> {
  return repo().findOne({ where: { user_id: userId, album_mbid: albumMbid } });
}

export async function listPurchases(userId: number): Promise<Purchase[]> {
  return repo().find({
    where: { user_id: userId },
    order: { purchased_at: "DESC" },
  });
}

export async function insertPurchase(input: PurchaseInput): Promise<Purchase> {
  const repository = repo();
  return repository.save(
    repository.create({
      user_id: input.userId,
      album_mbid: input.albumMbid,
      artist_name: input.artistName,
      album_title: input.albumTitle,
      price: input.price,
      currency: input.currency,
    })
  );
}

export async function updatePurchasePrice(
  purchase: Purchase,
  price: number,
  currency: string,
  purchasedAt: string
): Promise<Purchase> {
  purchase.price = price;
  purchase.currency = currency;
  purchase.purchased_at = purchasedAt;
  return repo().save(purchase);
}

export async function deletePurchase(purchase: Purchase): Promise<void> {
  await repo().remove(purchase);
}

/** Total spend in `currency`, optionally only counting purchases at or after `boundary`. */
export async function sumSpend(
  userId: number,
  currency: string,
  boundary: string | null
): Promise<number> {
  const qb = repo()
    .createQueryBuilder("p")
    .select("SUM(p.price)", "total")
    .where("p.user_id = :userId", { userId })
    .andWhere("p.currency = :currency", { currency });

  if (boundary) {
    qb.andWhere("p.purchased_at >= :boundary", { boundary });
  }

  const row = (await qb.getRawOne()) as { total: number | null };
  return row.total ?? 0;
}

export async function countPurchases(
  userId: number,
  currency: string
): Promise<number> {
  const row = (await repo()
    .createQueryBuilder("p")
    .select("COUNT(*)", "count")
    .where("p.user_id = :userId", { userId })
    .andWhere("p.currency = :currency", { currency })
    .getRawOne()) as { count: number | null };
  return Number(row.count) || 0;
}
