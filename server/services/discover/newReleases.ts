import { getCachedFreshReleases } from "./feedCache";
import { isAllowedReleaseType } from "./typeFilter";
import {
  getFollowedReleasesForUser,
  parseSecondaryTypes,
  type FollowedReleaseWithArtist,
} from "../followed/followedService";
import {
  buildReleaseKey,
  coverArtUrlForReleaseGroup,
} from "../followed/releaseAggregator";
import { getArtistList } from "../lidarr/artists";
import { enrichRequestsWithLidarr } from "../requests/lidarrEnrichment";
import { getUserProfile } from "../../db/userProfile";
import { parseDerivedProfile } from "../../db/userProfile";
import type { ListenBrainzFreshRelease } from "../../api/listenbrainz/types";
import { createLogger } from "../../logger";

export type NewReleaseSource = "followed" | "library" | "similar";

export type NewReleaseItem = {
  releaseGroupMbid: string | null;
  title: string;
  artistName: string;
  artistMbid: string | null;
  releaseDate: string | null;
  source: NewReleaseSource;
  coverUrl: string | null;
  lidarrStatus: "downloading" | "wanted" | "imported" | null;
  followedReleaseId: number | null;
};

export type NewReleasesResult = {
  items: NewReleaseItem[];
  windowDays: number;
};

type Candidate = Omit<NewReleaseItem, "lidarrStatus"> & {
  unseen: boolean;
};

export const RELEASE_WINDOWS_DAYS = [30, 60, 90] as const;
export const TARGET_ITEM_COUNT = 6;

const FOLLOWED_FETCH_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
const SOURCE_PRECEDENCE: Record<NewReleaseSource, number> = {
  followed: 0,
  library: 1,
  similar: 2,
};

const log = createLogger("discover-new-releases");

function followedToCandidate(row: FollowedReleaseWithArtist): Candidate {
  return {
    releaseGroupMbid: row.release_group_mbid,
    title: row.album_title,
    artistName: row.artist_name,
    artistMbid: row.artist_mbid,
    releaseDate: row.release_date,
    source: "followed",
    coverUrl: row.cover_url,
    followedReleaseId: row.id,
    unseen: row.viewed_at === null,
  };
}

function feedToCandidate(
  release: ListenBrainzFreshRelease,
  source: NewReleaseSource
): Candidate {
  return {
    releaseGroupMbid: release.releaseGroupMbid,
    title: release.releaseName,
    artistName: release.artistName,
    artistMbid: release.artistMbids[0] ?? null,
    releaseDate: release.releaseDate,
    source,
    coverUrl: coverArtUrlForReleaseGroup(release.releaseGroupMbid),
    followedReleaseId: null,
    unseen: false,
  };
}

function isFollowedRowAllowed(row: FollowedReleaseWithArtist): boolean {
  return isAllowedReleaseType(
    row.release_type,
    parseSecondaryTypes(row.secondary_types)
  );
}

function isFeedReleaseAllowed(release: ListenBrainzFreshRelease): boolean {
  return isAllowedReleaseType(
    release.primaryType,
    release.secondaryType === null ? [] : [release.secondaryType]
  );
}

function matchesArtistSet(
  release: ListenBrainzFreshRelease,
  mbids: ReadonlySet<string>
): boolean {
  return release.artistMbids.some((mbid) => mbids.has(mbid));
}

/**
 * Artist-scoped title+month key so a pre-backfill followed item (no MBID yet)
 * still suppresses its feed twin without colliding across artists.
 */
function titleDedupKey(candidate: Candidate): string {
  return buildReleaseKey(
    `${candidate.artistName} ${candidate.title}`,
    candidate.releaseDate
  );
}

/**
 * Dedup across tiers: followed > library > similar. Every candidate registers
 * under its release-group MBID (when known) and an artist-scoped title key,
 * so the same release keeps only its highest-precedence entry.
 */
function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const byKey = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const keys = [titleDedupKey(candidate)];
    if (candidate.releaseGroupMbid !== null) {
      keys.push(candidate.releaseGroupMbid);
    }
    const existing = keys.map((k) => byKey.get(k)).find((c) => c !== undefined);
    if (
      existing &&
      SOURCE_PRECEDENCE[existing.source] <= SOURCE_PRECEDENCE[candidate.source]
    ) {
      continue;
    }
    for (const key of keys) byKey.set(key, candidate);
  }
  return Array.from(new Set(byKey.values()));
}

function withinWindow(
  candidate: Candidate,
  windowDays: number,
  now: number
): boolean {
  if (!candidate.releaseDate) return false;
  const released = Date.parse(candidate.releaseDate);
  if (Number.isNaN(released)) return false;
  return released <= now && now - released <= windowDays * DAY_MS;
}

function compareCandidates(a: Candidate, b: Candidate): number {
  const aPriority = a.source === "followed" && a.unseen ? 0 : 1;
  const bPriority = b.source === "followed" && b.unseen ? 0 : 1;
  if (aPriority !== bPriority) return aPriority - bPriority;
  return (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "");
}

async function loadLibraryArtistMbids(): Promise<Set<string>> {
  const result = await getArtistList();
  if (!result.ok) {
    log.warn(`Lidarr artist list unavailable: ${result.error}`);
    return new Set();
  }
  return new Set(result.data.map((a) => a.foreignArtistId).filter(Boolean));
}

async function loadSimilarArtistMbids(userId: number): Promise<Set<string>> {
  const profile = await getUserProfile(userId);
  if (!profile) return new Set();
  const derived = parseDerivedProfile(profile.profile_json);
  const mbids = new Set<string>();
  for (const seed of derived.similarGraph) {
    for (const candidate of seed.candidates) {
      if (candidate.artistMbid) mbids.add(candidate.artistMbid);
    }
  }
  return mbids;
}

async function enrichWithLidarrStatus(
  candidates: Candidate[]
): Promise<NewReleaseItem[]> {
  const mbids = candidates
    .map((c) => c.releaseGroupMbid)
    .filter((mbid): mbid is string => mbid !== null);
  const details = mbids.length > 0 ? await enrichRequestsWithLidarr(mbids) : [];

  const statusByMbid = new Map(
    mbids.map((mbid, i) => [mbid, details[i]?.status ?? null])
  );

  return candidates.map(({ unseen: _unseen, ...item }) => ({
    ...item,
    lidarrStatus: item.releaseGroupMbid
      ? (statusByMbid.get(item.releaseGroupMbid) ?? null)
      : null,
  }));
}

/**
 * The blended new-releases shelf: followed releases (poller pipeline) plus
 * library and similar artists intersected against the cached ListenBrainz
 * feed. One shared window widens 30 → 60 → 90 days until the target count
 * exists; unseen followed releases claim slots first, then newest wins.
 */
export async function getNewReleases(
  userId: number,
  now: number = Date.now()
): Promise<NewReleasesResult> {
  const [followedRows, feed, libraryMbids, similarMbids] = await Promise.all([
    getFollowedReleasesForUser(userId, FOLLOWED_FETCH_LIMIT),
    getCachedFreshReleases(),
    loadLibraryArtistMbids(),
    loadSimilarArtistMbids(userId),
  ]);

  const allowedFeed = feed.filter(isFeedReleaseAllowed);
  const candidates = dedupeCandidates([
    ...followedRows.filter(isFollowedRowAllowed).map(followedToCandidate),
    ...allowedFeed
      .filter((r) => matchesArtistSet(r, libraryMbids))
      .map((r) => feedToCandidate(r, "library")),
    ...allowedFeed
      .filter((r) => matchesArtistSet(r, similarMbids))
      .map((r) => feedToCandidate(r, "similar")),
  ]);

  let windowDays: number =
    RELEASE_WINDOWS_DAYS[RELEASE_WINDOWS_DAYS.length - 1];
  let pool: Candidate[] = [];
  for (const window of RELEASE_WINDOWS_DAYS) {
    pool = candidates.filter((c) => withinWindow(c, window, now));
    if (pool.length >= TARGET_ITEM_COUNT) {
      windowDays = window;
      break;
    }
  }

  const selected = pool.sort(compareCandidates).slice(0, TARGET_ITEM_COUNT);
  const items = await enrichWithLidarrStatus(selected);

  return { items, windowDays };
}
