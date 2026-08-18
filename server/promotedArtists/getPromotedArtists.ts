import { loadArtistWeights } from "../promotedAlbum/artistWeights";
import { getSimilarArtists } from "../api/lastfm/artists";
import { enrichArtistsWithImages } from "../services/lastfm";
import { lidarrGet } from "../api/lidarr/get";
import type { LidarrArtist } from "../api/lidarr/types";
import { getConfigValue } from "../config";
import { weightedRandomPick, shuffle } from "../utils/random";
import { createTtlMap } from "../utils/ttlMap";
import { isPlaceholderArtist } from "../utils/artistFilter";
import { findUserById } from "../auth/users";
import {
  getUserProfile,
  updateExplorationHistory,
  parseDerivedProfile,
} from "../db/userProfile";
import type { PromotedArtist, PromotedArtistsResult } from "./types";

export type { PromotedArtistsResult } from "./types";

type SimilarArtist = {
  name: string;
  mbid: string;
  match: number;
  imageUrl: string;
};

type LibraryLookup = (name: string, mbid: string) => boolean;

const RESULT_COUNT = 6;
const RECENT_SHOWN_LIMIT = 18;

/** Short-lived per-user result cache; entries expire and are swept on write. */
const resultCache = createTtlMap<number, PromotedArtistsResult>();

export function clearPromotedArtistsCache() {
  resultCache.clear();
}

function mergeRecentArtists(names: string[], previous: string[]): string[] {
  return Array.from(new Set([...names, ...previous])).slice(
    0,
    RECENT_SHOWN_LIMIT
  );
}

async function safeSimilar(name: string): Promise<SimilarArtist[]> {
  try {
    return await getSimilarArtists(name);
  } catch {
    return [];
  }
}

async function loadLibraryLookup(): Promise<LibraryLookup> {
  let mbids = new Set<string>();
  let names = new Set<string>();
  try {
    const result = await lidarrGet<LidarrArtist[]>("/artist");
    if (result.ok) {
      mbids = new Set(result.data.map((a) => a.foreignArtistId));
      names = new Set(result.data.map((a) => a.artistName.toLowerCase()));
    }
  } catch {
    // Lidarr unavailable — treat all as not in library
  }
  return (name, mbid) =>
    (mbid !== "" && mbids.has(mbid)) || names.has(name.toLowerCase());
}

function mergeSimilar(
  similarLists: SimilarArtist[][],
  excludeNames: Set<string>
): SimilarArtist[] {
  const byName = new Map<string, SimilarArtist>();

  for (const list of similarLists) {
    for (const artist of list) {
      const key = artist.name.toLowerCase();
      if (excludeNames.has(key)) continue;
      if (isPlaceholderArtist(artist.name, artist.mbid)) continue;

      const existing = byName.get(key);
      if (!existing || artist.match > existing.match) {
        byName.set(key, artist);
      }
    }
  }

  return Array.from(byName.values());
}

/**
 * The shuffle decides *which* artists appear, so repeat visits vary. The sort
 * only decides the order they are shown in: weakest match first, so the grid
 * reads towards the closest match rather than away from it.
 */
function pickArtists(
  merged: SimilarArtist[],
  recentlyShown: Set<string>
): SimilarArtist[] {
  const fresh = merged.filter((a) => !recentlyShown.has(a.name.toLowerCase()));
  const pool = fresh.length >= RESULT_COUNT ? fresh : merged;
  return shuffle(pool)
    .slice(0, RESULT_COUNT)
    .sort((a, b) => a.match - b.match);
}

export async function getPromotedArtists(
  userId: number,
  forceRefresh = false
): Promise<PromotedArtistsResult> {
  const config = getConfigValue("promotedAlbum");
  const cacheDurationMs = config.cacheDurationMinutes * 60 * 1000;

  const cached = forceRefresh ? undefined : resultCache.get(userId);
  if (cached) return cached;

  const user = await findUserById(userId);
  const plexToken = user?.plexToken;
  if (!plexToken) return null;

  const weighted = await loadArtistWeights(userId, plexToken, {
    windowMs: config.playTrendWindowDays * 24 * 60 * 60 * 1000,
    ratingWeight: config.ratingWeight,
    distributionWeight: config.distributionWeight,
    minPlaysForDistribution: config.minPlaysForDistribution,
    minAvailableTracksForDistribution: config.minAvailableTracksForDistribution,
  });
  if (weighted.length === 0) return null;

  const topArtists = [...weighted]
    .sort((a, b) => b.viewCount - a.viewCount)
    .slice(0, config.topArtistsCount);

  const seeds = weightedRandomPick(
    topArtists,
    (a) => a.viewCount,
    config.pickedArtistsCount
  );
  if (seeds.length === 0) return null;

  const similarLists = await Promise.all(
    seeds.map((seed) => safeSimilar(seed.name))
  );

  const topNames = new Set(topArtists.map((a) => a.name.toLowerCase()));
  const merged = mergeSimilar(similarLists, topNames);
  if (merged.length === 0) return null;

  const profileRow = await getUserProfile(userId);
  const recentArtists = profileRow
    ? parseDerivedProfile(profileRow.profile_json).explorationHistory.artists
    : [];
  const chosen = pickArtists(merged, new Set(recentArtists));

  const enriched = await enrichArtistsWithImages(chosen);
  const inLibrary = await loadLibraryLookup();

  const artists: PromotedArtist[] = enriched.map((a) => ({
    name: a.name,
    mbid: a.mbid,
    imageUrl: a.imageUrl,
    match: a.match,
    inLibrary: inLibrary(a.name, a.mbid),
  }));

  const result: PromotedArtistsResult = {
    artists,
    seedArtists: seeds.map((s) => s.name),
  };

  const nextArtists = mergeRecentArtists(
    artists.map((a) => a.name.toLowerCase()),
    recentArtists
  );
  await updateExplorationHistory(userId, { artists: nextArtists });
  resultCache.set(userId, result, cacheDurationMs);

  return result;
}
