import { getTopAlbumsByTag } from "../api/lastfm/albums";
import { lidarrGet } from "../api/lidarr/get";
import type { LidarrAlbum, LidarrArtist } from "../api/lidarr/types";
import { getReleaseGroupIdFromRelease } from "../api/musicbrainz/releaseGroups";
import type { ReleaseGroupInfo } from "../api/musicbrainz/types";
import { getConfigValue } from "../config";
import {
  deriveAlbumLibraryInfo,
  type AlbumLibraryInfo,
} from "../../shared/albumLibrary";
import type { LibraryPreference, PromotedAlbumConfig } from "../config";
import { weightedRandomPick, shuffle } from "../utils/random";
import { isPlaceholderArtist } from "../utils/artistFilter";
import { findUserById } from "../auth/users";
import { updateExplorationHistory } from "../db/userProfile";
import type { DerivedProfile } from "../db/entity/UserProfile";
import { getMonitoredAlbums } from "../services/lidarr/albums";
import { buildExploreResult } from "./explore";
import { loadFreshProfile } from "./profileService";
import type {
  BuiltAlbum,
  PromotedAlbumResult,
  WithinTasteResult,
  WithinTasteTrace,
  TraceArtistEntry,
  TraceAlbumPoolInfo,
  TraceSelectionReason,
  TraceWeightedTag,
} from "./types";

export type { PromotedAlbumResult } from "./types";

type WeightedTag = { name: string; weight: number };

type CacheEntry = { result: PromotedAlbumResult; cachedAt: number };

const RECENT_SHOWN_LIMIT = 10;

/** Short-lived final-result cache (layer 2) — keeps album selection off MusicBrainz on every load. */
const resultCache = new Map<number, CacheEntry>();

export function clearPromotedAlbumCache() {
  resultCache.clear();
}

function buildTraceFromProfile(
  profile: DerivedProfile,
  chosenTag: WeightedTag,
  albumPool: TraceAlbumPoolInfo,
  selectionReason: TraceSelectionReason
): WithinTasteTrace {
  const plexArtists: TraceArtistEntry[] = profile.artistTags.map((a) => ({
    name: a.name,
    viewCount: a.viewCount,
    picked: true,
    tagContributions: a.tags.map((t) => ({
      tagName: t.name,
      rawCount: t.count,
      weight: t.count * a.viewCount,
    })),
  }));

  const weightedTags: TraceWeightedTag[] = profile.genreVector.map((g) => ({
    name: g.tag,
    weight: g.weight,
    fromArtists: g.fromArtists,
  }));

  return {
    kind: "within_taste",
    plexArtists,
    weightedTags,
    chosenTag: { name: chosenTag.name, weight: chosenTag.weight },
    albumPool,
    selectionReason,
  };
}

function selectAlbumPreferNew(
  shuffled: {
    mbid: string;
    artistMbid: string;
    name: string;
    artistName: string;
  }[],
  artistInLibrary: (mbid: string) => boolean,
  getRgInfo: (mbid: string) => Promise<ReleaseGroupInfo | null>
): Promise<{
  album: (typeof shuffled)[0];
  rgMbid: string;
  year: string;
  reason: TraceSelectionReason;
} | null> {
  return selectAlbumWithPreference(
    shuffled,
    (a) => !artistInLibrary(a.artistMbid),
    getRgInfo,
    "preferred_non_library",
    "fallback_in_library"
  );
}

function selectAlbumPreferLibrary(
  shuffled: {
    mbid: string;
    artistMbid: string;
    name: string;
    artistName: string;
  }[],
  artistInLibrary: (mbid: string) => boolean,
  getRgInfo: (mbid: string) => Promise<ReleaseGroupInfo | null>
): Promise<{
  album: (typeof shuffled)[0];
  rgMbid: string;
  year: string;
  reason: TraceSelectionReason;
} | null> {
  return selectAlbumWithPreference(
    shuffled,
    (a) => artistInLibrary(a.artistMbid),
    getRgInfo,
    "preferred_library",
    "fallback_non_library"
  );
}

async function selectAlbumNoPreference(
  shuffled: {
    mbid: string;
    artistMbid: string;
    name: string;
    artistName: string;
  }[],
  getRgInfo: (mbid: string) => Promise<ReleaseGroupInfo | null>
): Promise<{
  album: (typeof shuffled)[0];
  rgMbid: string;
  year: string;
  reason: TraceSelectionReason;
} | null> {
  for (const album of shuffled) {
    const rgInfo = await getRgInfo(album.mbid);
    if (rgInfo) {
      return {
        album,
        rgMbid: rgInfo.id,
        year: rgInfo.firstReleaseDate.slice(0, 4),
        reason: "no_preference",
      };
    }
  }
  return null;
}

async function selectAlbumWithPreference(
  shuffled: {
    mbid: string;
    artistMbid: string;
    name: string;
    artistName: string;
  }[],
  isPreferred: (album: (typeof shuffled)[0]) => boolean,
  getRgInfo: (mbid: string) => Promise<ReleaseGroupInfo | null>,
  preferredReason: TraceSelectionReason,
  fallbackReason: TraceSelectionReason
): Promise<{
  album: (typeof shuffled)[0];
  rgMbid: string;
  year: string;
  reason: TraceSelectionReason;
} | null> {
  let fallback:
    { album: (typeof shuffled)[0]; rgMbid: string; year: string } | undefined;

  for (const album of shuffled) {
    const rgInfo = await getRgInfo(album.mbid);
    if (!rgInfo) continue;

    const year = rgInfo.firstReleaseDate.slice(0, 4);
    if (isPreferred(album)) {
      return { album, rgMbid: rgInfo.id, year, reason: preferredReason };
    }
    if (!fallback) {
      fallback = { album, rgMbid: rgInfo.id, year };
    }
  }

  return fallback ? { ...fallback, reason: fallbackReason } : null;
}

function selectAlbum(
  shuffled: {
    mbid: string;
    artistMbid: string;
    name: string;
    artistName: string;
  }[],
  artistInLibrary: (mbid: string) => boolean,
  libraryPreference: LibraryPreference,
  getRgInfo: (mbid: string) => Promise<ReleaseGroupInfo | null>
) {
  switch (libraryPreference) {
    case "prefer_new":
      return selectAlbumPreferNew(shuffled, artistInLibrary, getRgInfo);
    case "prefer_library":
      return selectAlbumPreferLibrary(shuffled, artistInLibrary, getRgInfo);
    case "no_preference":
      return selectAlbumNoPreference(shuffled, getRgInfo);
  }
}

/**
 * Per-request within-taste selection off the persisted profile: pick a tag from the
 * stored genre vector, fetch a fresh album pool for it, and select an album. The
 * expensive Plex + Last.fm fan-out is NOT re-run here — that lives in the profile.
 */
async function buildWithinTasteFromProfile(
  profile: DerivedProfile,
  config: PromotedAlbumConfig,
  recentlyShown: Set<string>,
  artistInLibrary: (mbid: string) => boolean,
  albumLibrary: (mbid: string) => AlbumLibraryInfo | null
): Promise<BuiltAlbum | null> {
  const weightedTags: WeightedTag[] = profile.genreVector.map((g) => ({
    name: g.tag,
    weight: g.weight,
  }));
  if (weightedTags.length === 0) return null;

  const [chosenTag] = weightedRandomPick(weightedTags, (t) => t.weight, 1);
  if (!chosenTag) return null;

  const range = config.deepPageMax - config.deepPageMin + 1;
  const deepPage = String(
    Math.floor(Math.random() * range) + config.deepPageMin
  );
  const [page1, pageDeep] = await Promise.all([
    getTopAlbumsByTag(chosenTag.name, "1"),
    getTopAlbumsByTag(chosenTag.name, deepPage),
  ]);

  const seen = new Set<string>();
  const allAlbums = [...page1.albums, ...pageDeep.albums].filter((a) => {
    if (!a.mbid) return false;
    if (isPlaceholderArtist(a.artistName, a.artistMbid)) return false;
    if (seen.has(a.mbid)) return false;
    seen.add(a.mbid);
    return true;
  });
  if (allAlbums.length === 0) return null;

  const freshAlbums = allAlbums.filter((a) => !recentlyShown.has(a.mbid));
  const candidatePool = freshAlbums.length > 0 ? freshAlbums : allAlbums;
  const shuffled = shuffle(candidatePool);

  const picked = await selectAlbum(
    shuffled,
    artistInLibrary,
    config.libraryPreference,
    getReleaseGroupIdFromRelease
  );
  if (!picked) return null;

  const albumPoolInfo: TraceAlbumPoolInfo = {
    page1Count: page1.albums.length,
    deepPage: Number(deepPage),
    deepPageCount: pageDeep.albums.length,
    totalAfterDedup: allAlbums.length,
  };

  const trace = buildTraceFromProfile(
    profile,
    chosenTag,
    albumPoolInfo,
    picked.reason
  );

  const library = albumLibrary(picked.rgMbid);

  const result: WithinTasteResult = {
    mode: "within_taste",
    album: {
      name: picked.album.name,
      mbid: picked.rgMbid,
      artistName: picked.album.artistName,
      artistMbid: picked.album.artistMbid,
      coverUrl: `https://coverartarchive.org/release-group/${picked.rgMbid}/front-500`,
      year: picked.year,
    },
    tag: chosenTag.name,
    inLibrary: library !== null,
    library,
    trace,
  };

  return { result, rememberKey: picked.album.mbid };
}

async function loadLibraryMbids(): Promise<{
  artistInLibrary: (mbid: string) => boolean;
  albumLibrary: (mbid: string) => AlbumLibraryInfo | null;
}> {
  let libraryArtistMbids = new Set<string>();
  let libraryAlbums = new Map<string, LidarrAlbum>();
  try {
    // Lidarr keeps a row for every album in a tracked artist's discography, so
    // only the monitored ones say anything about what this library holds or wants.
    const [artistResult, albumResult] = await Promise.all([
      lidarrGet<LidarrArtist[]>("/artist"),
      getMonitoredAlbums(),
    ]);
    if (artistResult.ok) {
      libraryArtistMbids = new Set(
        artistResult.data.map((a) => a.foreignArtistId)
      );
    }
    if (albumResult.ok) {
      libraryAlbums = new Map(
        albumResult.data.map((a) => [a.foreignAlbumId, a])
      );
    }
  } catch {
    // Lidarr unavailable — treat all as not in library
  }

  return {
    artistInLibrary: (mbid) => libraryArtistMbids.has(mbid),
    albumLibrary: (mbid) => {
      const album = libraryAlbums.get(mbid);
      return album ? deriveAlbumLibraryInfo(album.statistics) : null;
    },
  };
}

function buildExplore(
  profile: DerivedProfile,
  config: PromotedAlbumConfig,
  recentlyShown: Set<string>,
  artistInLibrary: (mbid: string) => boolean,
  albumLibrary: (mbid: string) => AlbumLibraryInfo | null
): Promise<BuiltAlbum | null> {
  return buildExploreResult({
    similarGraph: profile.similarGraph,
    config,
    recentlyShown,
    artistInLibrary,
    albumLibrary,
  });
}

export async function getPromotedAlbum(
  userId: number,
  forceRefresh = false
): Promise<PromotedAlbumResult> {
  const config = getConfigValue("promotedAlbum");
  const resultTtlMs = config.cacheDurationMinutes * 60 * 1000;

  const cached = resultCache.get(userId);
  if (!forceRefresh && cached && Date.now() - cached.cachedAt < resultTtlMs) {
    return cached.result;
  }

  const user = await findUserById(userId);
  const plexToken = user?.plexToken;
  if (!plexToken) return null;

  const profile = await loadFreshProfile(userId, plexToken, config);

  const { artistInLibrary, albumLibrary } = await loadLibraryMbids();
  const recentAlbums = profile?.explorationHistory.albums ?? [];
  const recentlyShown = new Set(recentAlbums);

  let built: BuiltAlbum | null = null;
  if (profile && Math.random() < config.explorationRate) {
    built = await buildExplore(
      profile,
      config,
      recentlyShown,
      artistInLibrary,
      albumLibrary
    );
  }
  if (!built && profile) {
    built = await buildWithinTasteFromProfile(
      profile,
      config,
      recentlyShown,
      artistInLibrary,
      albumLibrary
    );
  }
  if (!built) return null;

  const nextAlbums = [
    built.rememberKey,
    ...recentAlbums.filter((m) => m !== built.rememberKey),
  ].slice(0, RECENT_SHOWN_LIMIT);
  await updateExplorationHistory(userId, { albums: nextAlbums });

  resultCache.set(userId, { result: built.result, cachedAt: Date.now() });

  return built.result;
}
