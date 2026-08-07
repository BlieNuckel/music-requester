import { getDataSource, FollowedArtist, FollowedRelease } from "../../db/index";
import { createLogger } from "../../logger";

type AddFollowResult =
  { status: "added"; id: number } | { status: "already_following"; id: number };

type RemoveFollowResult = { status: "removed" } | { status: "not_found" };

type RecordReleaseInput = {
  followed_artist_id: number;
  release_key: string;
  album_title: string;
  release_date: string | null;
  release_group_mbid: string | null;
  cover_url: string | null;
  release_type: string | null;
  secondary_types: string[] | null;
};

type ReleaseMetadataPatch = {
  release_group_mbid: string;
  cover_url: string | null;
  release_type: string | null;
  secondary_types: string[] | null;
};

export type FollowedReleaseWithArtist = FollowedRelease & {
  artist_name: string;
  artist_mbid: string;
};

const log = createLogger("followed");

function serializeSecondaryTypes(types: string[] | null): string | null {
  return types === null ? null : JSON.stringify(types);
}

export function parseSecondaryTypes(json: string | null): string[] | null {
  if (json === null) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((t) => typeof t === "string")
      : null;
  } catch {
    return null;
  }
}

function getFollowedRepo() {
  return getDataSource().getRepository(FollowedArtist);
}

function getReleaseRepo() {
  return getDataSource().getRepository(FollowedRelease);
}

export async function followArtist(
  userId: number,
  artistMbid: string,
  artistName: string
): Promise<AddFollowResult> {
  const repo = getFollowedRepo();

  const existing = await repo.findOne({
    where: { user_id: userId, artist_mbid: artistMbid },
  });

  if (existing) {
    return { status: "already_following", id: existing.id };
  }

  const item = repo.create({
    user_id: userId,
    artist_mbid: artistMbid,
    artist_name: artistName,
    last_checked_at: null,
  });

  const saved = await repo.save(item);
  log.info(`User ${userId} followed "${artistName}" (${artistMbid})`);

  return { status: "added", id: saved.id };
}

export async function unfollowArtist(
  userId: number,
  artistMbid: string
): Promise<RemoveFollowResult> {
  const repo = getFollowedRepo();

  const item = await repo.findOne({
    where: { user_id: userId, artist_mbid: artistMbid },
  });

  if (!item) {
    return { status: "not_found" };
  }

  await repo.remove(item);
  log.info(`User ${userId} unfollowed "${item.artist_name}"`);

  return { status: "removed" };
}

export async function getFollowedArtists(
  userId: number
): Promise<FollowedArtist[]> {
  const repo = getFollowedRepo();

  return repo.find({
    where: { user_id: userId },
    order: { created_at: "DESC" },
  });
}

export async function getAllFollowedArtists(): Promise<FollowedArtist[]> {
  const repo = getFollowedRepo();
  return repo.find({ order: { created_at: "ASC" } });
}

export async function findFollowedRelease(
  followedArtistId: number,
  releaseKey: string
): Promise<FollowedRelease | null> {
  const repo = getReleaseRepo();
  return repo.findOne({
    where: { followed_artist_id: followedArtistId, release_key: releaseKey },
  });
}

export async function recordFollowedRelease(
  input: RecordReleaseInput
): Promise<FollowedRelease> {
  const repo = getReleaseRepo();
  const row = repo.create({
    ...input,
    secondary_types: serializeSecondaryTypes(input.secondary_types),
  });
  return repo.save(row);
}

/** Fills MB-derived metadata onto a release first seen from Deezer. */
export async function backfillReleaseMetadata(
  releaseId: number,
  patch: ReleaseMetadataPatch
): Promise<void> {
  const repo = getReleaseRepo();
  await repo.update(
    { id: releaseId },
    {
      release_group_mbid: patch.release_group_mbid,
      cover_url: patch.cover_url,
      release_type: patch.release_type,
      secondary_types: serializeSecondaryTypes(patch.secondary_types),
    }
  );
}

export async function getFollowedReleasesForUser(
  userId: number,
  limit = 50
): Promise<FollowedReleaseWithArtist[]> {
  const ds = getDataSource();
  const rows = (await ds.query(
    `SELECT fr.*, fa.artist_name as artist_name, fa.artist_mbid as artist_mbid
     FROM followed_releases fr
     INNER JOIN followed_artists fa ON fr.followed_artist_id = fa.id
     WHERE fa.user_id = ?
     ORDER BY fr.release_date IS NULL, fr.release_date DESC, fr.notified_at DESC
     LIMIT ?`,
    [userId, limit]
  )) as FollowedReleaseWithArtist[];
  return rows;
}

export async function updateLastCheckedAt(
  followedArtistId: number,
  isoTimestamp: string
): Promise<void> {
  const repo = getFollowedRepo();
  await repo.update(
    { id: followedArtistId },
    { last_checked_at: isoTimestamp }
  );
}

export async function getUnseenReleaseCount(userId: number): Promise<number> {
  const ds = getDataSource();
  const rows = (await ds.query(
    `SELECT COUNT(fr.id) as count
     FROM followed_releases fr
     INNER JOIN followed_artists fa ON fr.followed_artist_id = fa.id
     WHERE fa.user_id = ? AND fr.viewed_at IS NULL`,
    [userId]
  )) as { count: number }[];
  return rows[0]?.count ?? 0;
}

export async function markFollowedReleasesViewed(
  userId: number
): Promise<void> {
  const ds = getDataSource();
  await ds.query(
    `UPDATE followed_releases
     SET viewed_at = ?
     WHERE viewed_at IS NULL
       AND followed_artist_id IN (
         SELECT id FROM followed_artists WHERE user_id = ?
       )`,
    [new Date().toISOString(), userId]
  );
}

/** Marks a single release viewed; returns false when the row isn't the user's. */
export async function markFollowedReleaseViewed(
  userId: number,
  releaseId: number
): Promise<boolean> {
  const ds = getDataSource();
  const rows = (await ds.query(
    `SELECT fr.id
     FROM followed_releases fr
     INNER JOIN followed_artists fa ON fr.followed_artist_id = fa.id
     WHERE fr.id = ? AND fa.user_id = ?`,
    [releaseId, userId]
  )) as { id: number }[];

  if (rows.length === 0) return false;

  await getReleaseRepo().update(
    { id: releaseId },
    { viewed_at: new Date().toISOString() }
  );
  return true;
}
