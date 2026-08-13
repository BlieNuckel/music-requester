import { getDataSource, FollowedArtist, FollowedRelease } from "./index";

export type RecordReleaseInput = {
  followed_artist_id: number;
  release_key: string;
  album_title: string;
  release_date: string | null;
  release_group_mbid: string | null;
  cover_url: string | null;
  release_type: string | null;
  secondary_types: string[] | null;
};

export type ReleaseMetadataPatch = {
  release_group_mbid: string;
  cover_url: string | null;
  release_type: string | null;
  secondary_types: string[] | null;
};

export type FollowedReleaseWithArtist = FollowedRelease & {
  artist_name: string;
  artist_mbid: string;
};

function artistRepo() {
  return getDataSource().getRepository(FollowedArtist);
}

function releaseRepo() {
  return getDataSource().getRepository(FollowedRelease);
}

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

export async function findFollowedArtist(
  userId: number,
  artistMbid: string
): Promise<FollowedArtist | null> {
  return artistRepo().findOne({
    where: { user_id: userId, artist_mbid: artistMbid },
  });
}

export async function insertFollowedArtist(
  userId: number,
  artistMbid: string,
  artistName: string
): Promise<FollowedArtist> {
  const repo = artistRepo();
  return repo.save(
    repo.create({
      user_id: userId,
      artist_mbid: artistMbid,
      artist_name: artistName,
      last_checked_at: null,
    })
  );
}

export async function deleteFollowedArtist(
  artist: FollowedArtist
): Promise<void> {
  await artistRepo().remove(artist);
}

export async function listFollowedArtists(
  userId: number
): Promise<FollowedArtist[]> {
  return artistRepo().find({
    where: { user_id: userId },
    order: { created_at: "DESC" },
  });
}

export async function listAllFollowedArtists(): Promise<FollowedArtist[]> {
  return artistRepo().find({ order: { created_at: "ASC" } });
}

export async function updateLastCheckedAt(
  followedArtistId: number,
  isoTimestamp: string
): Promise<void> {
  await artistRepo().update(
    { id: followedArtistId },
    { last_checked_at: isoTimestamp }
  );
}

export async function findFollowedRelease(
  followedArtistId: number,
  releaseKey: string
): Promise<FollowedRelease | null> {
  return releaseRepo().findOne({
    where: { followed_artist_id: followedArtistId, release_key: releaseKey },
  });
}

export async function recordFollowedRelease(
  input: RecordReleaseInput
): Promise<FollowedRelease> {
  const repo = releaseRepo();
  return repo.save(
    repo.create({
      ...input,
      secondary_types: serializeSecondaryTypes(input.secondary_types),
    })
  );
}

/** Fills MB-derived metadata onto a release first seen from Deezer. */
export async function backfillReleaseMetadata(
  releaseId: number,
  patch: ReleaseMetadataPatch
): Promise<void> {
  await releaseRepo().update(
    { id: releaseId },
    {
      release_group_mbid: patch.release_group_mbid,
      cover_url: patch.cover_url,
      release_type: patch.release_type,
      secondary_types: serializeSecondaryTypes(patch.secondary_types),
    }
  );
}

export async function listFollowedReleasesForUser(
  userId: number,
  limit = 50
): Promise<FollowedReleaseWithArtist[]> {
  return (await getDataSource().query(
    `SELECT fr.*, fa.artist_name as artist_name, fa.artist_mbid as artist_mbid
     FROM followed_releases fr
     INNER JOIN followed_artists fa ON fr.followed_artist_id = fa.id
     WHERE fa.user_id = ?
     ORDER BY fr.release_date IS NULL, fr.release_date DESC, fr.notified_at DESC
     LIMIT ?`,
    [userId, limit]
  )) as FollowedReleaseWithArtist[];
}

export async function countUnseenReleases(userId: number): Promise<number> {
  const rows = (await getDataSource().query(
    `SELECT COUNT(fr.id) as count
     FROM followed_releases fr
     INNER JOIN followed_artists fa ON fr.followed_artist_id = fa.id
     WHERE fa.user_id = ? AND fr.viewed_at IS NULL`,
    [userId]
  )) as { count: number }[];
  return rows[0]?.count ?? 0;
}

export async function markAllReleasesViewed(userId: number): Promise<void> {
  await getDataSource().query(
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
export async function markReleaseViewed(
  userId: number,
  releaseId: number
): Promise<boolean> {
  const rows = (await getDataSource().query(
    `SELECT fr.id
     FROM followed_releases fr
     INNER JOIN followed_artists fa ON fr.followed_artist_id = fa.id
     WHERE fr.id = ? AND fa.user_id = ?`,
    [releaseId, userId]
  )) as { id: number }[];

  if (rows.length === 0) return false;

  await releaseRepo().update(
    { id: releaseId },
    { viewed_at: new Date().toISOString() }
  );
  return true;
}
