import type { FollowedArtist } from "../../db/index";
import {
  countUnseenReleases,
  deleteFollowedArtist,
  findFollowedArtist,
  insertFollowedArtist,
  listAllFollowedArtists,
  listFollowedArtists,
  listFollowedReleasesForUser,
  markAllReleasesViewed,
  markReleaseViewed,
  type FollowedReleaseWithArtist,
} from "../../db/followed";
import { createLogger } from "../../logger";

type AddFollowResult =
  { status: "added"; id: number } | { status: "already_following"; id: number };

type RemoveFollowResult = { status: "removed" } | { status: "not_found" };

export type { FollowedReleaseWithArtist };

export {
  backfillReleaseMetadata,
  findFollowedRelease,
  parseSecondaryTypes,
  recordFollowedRelease,
  updateLastCheckedAt,
} from "../../db/followed";

const log = createLogger("followed");

export async function followArtist(
  userId: number,
  artistMbid: string,
  artistName: string
): Promise<AddFollowResult> {
  const existing = await findFollowedArtist(userId, artistMbid);
  if (existing) {
    return { status: "already_following", id: existing.id };
  }

  const saved = await insertFollowedArtist(userId, artistMbid, artistName);
  log.info(`User ${userId} followed "${artistName}" (${artistMbid})`);

  return { status: "added", id: saved.id };
}

export async function unfollowArtist(
  userId: number,
  artistMbid: string
): Promise<RemoveFollowResult> {
  const item = await findFollowedArtist(userId, artistMbid);
  if (!item) {
    return { status: "not_found" };
  }

  await deleteFollowedArtist(item);
  log.info(`User ${userId} unfollowed "${item.artist_name}"`);

  return { status: "removed" };
}

export async function getFollowedArtists(
  userId: number
): Promise<FollowedArtist[]> {
  return listFollowedArtists(userId);
}

export async function getAllFollowedArtists(): Promise<FollowedArtist[]> {
  return listAllFollowedArtists();
}

export async function getFollowedReleasesForUser(
  userId: number,
  limit = 50
): Promise<FollowedReleaseWithArtist[]> {
  return listFollowedReleasesForUser(userId, limit);
}

export async function getUnseenReleaseCount(userId: number): Promise<number> {
  return countUnseenReleases(userId);
}

export async function markFollowedReleasesViewed(
  userId: number
): Promise<void> {
  return markAllReleasesViewed(userId);
}

export async function markFollowedReleaseViewed(
  userId: number,
  releaseId: number
): Promise<boolean> {
  return markReleaseViewed(userId, releaseId);
}
