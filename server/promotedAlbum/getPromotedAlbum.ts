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
import { weightedRandomPick, shuffle, type Rng } from "../utils/random";
import { createTtlMap } from "../utils/ttlMap";
import { isPlaceholderArtist } from "../utils/artistFilter";
import { findUserById } from "../auth/users";
import { updateExplorationHistory } from "../db/userProfile";
import type { DerivedProfile } from "../db/entity/UserProfile";
import { getMonitoredAlbums } from "../services/lidarr/albums";
import { buildExploreResult } from "./explore";
import { loadFreshProfile } from "./profileService";
import type {
  BuiltAlbum,
  PromotedAlbumEntry,
  WithinTasteResult,
  WithinTasteTrace,
  TraceArtistEntry,
  TraceAlbumPoolInfo,
  TraceSelectionReason,
  TraceWeightedTag,
} from "./types";

export type { PromotedAlbumResult, PromotedAlbumEntry } from "./types";

type WeightedTag = { name: string; weight: number };

type LibraryLookups = {
  artistInLibrary: (mbid: string) => boolean;
  albumLibrary: (mbid: string) => AlbumLibraryInfo | null;
};

/** One Last.fm tag-chart album, before it has been resolved to a release group. */
type CandidateAlbum = {
  mbid: string;
  artistMbid: string;
  name: string;
  artistName: string;
};

type AlbumSelection = {
  album: CandidateAlbum;
  rgMbid: string;
  year: string;
  reason: TraceSelectionReason;
};

type GetRgInfo = (mbid: string) => Promise<ReleaseGroupInfo | null>;

/**
 * Injected clock and randomness. Both default to the globals; tests pass their own so
 * the selection rules (how often we explore, how deep we page) can be asserted directly
 * instead of stubbing `Math.random` for every decision at once.
 */
export type PromotedAlbumDeps = {
  rng?: Rng;
  now?: () => number;
};

/** How many recommendations the spotlight carousel presents. */
export const SPOTLIGHT_COUNT = 5;

/** Spare attempts so dead tags or duplicate picks don't shorten the carousel. */
const PICK_ATTEMPT_SLACK = 3;

const RECENT_SHOWN_LIMIT = 25;

/** Short-lived final-result cache (layer 2) — keeps album selection off MusicBrainz on every load. */
const resultCache = createTtlMap<number, PromotedAlbumEntry[]>();

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
    distinctTracksPlayed: a.distinctTracksPlayed,
    topTrackShare: a.topTrackShare,
    distributionFactor: a.distributionFactor,
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

/**
 * Walk the shuffled pool and take the first album that resolves to a release group AND
 * satisfies `isPreferred`, falling back to the first that merely resolves. Albums that
 * don't resolve are skipped entirely.
 */
async function selectAlbumWithPreference(
  shuffled: CandidateAlbum[],
  isPreferred: (album: CandidateAlbum) => boolean,
  getRgInfo: GetRgInfo,
  preferredReason: TraceSelectionReason,
  fallbackReason: TraceSelectionReason
): Promise<AlbumSelection | null> {
  let fallback: Omit<AlbumSelection, "reason"> | undefined;

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
  shuffled: CandidateAlbum[],
  artistInLibrary: (mbid: string) => boolean,
  libraryPreference: LibraryPreference,
  getRgInfo: GetRgInfo
): Promise<AlbumSelection | null> {
  switch (libraryPreference) {
    case "prefer_new":
      return selectAlbumWithPreference(
        shuffled,
        (a) => !artistInLibrary(a.artistMbid),
        getRgInfo,
        "preferred_non_library",
        "fallback_in_library"
      );
    case "prefer_library":
      return selectAlbumWithPreference(
        shuffled,
        (a) => artistInLibrary(a.artistMbid),
        getRgInfo,
        "preferred_library",
        "fallback_non_library"
      );
    case "no_preference":
      return selectAlbumWithPreference(
        shuffled,
        () => true,
        getRgInfo,
        "no_preference",
        "no_preference"
      );
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
  albumLibrary: (mbid: string) => AlbumLibraryInfo | null,
  rng: Rng
): Promise<BuiltAlbum | null> {
  const weightedTags: WeightedTag[] = profile.genreVector.map((g) => ({
    name: g.tag,
    weight: g.weight,
  }));
  if (weightedTags.length === 0) return null;

  const [chosenTag] = weightedRandomPick(weightedTags, (t) => t.weight, 1, rng);
  if (!chosenTag) return null;

  const range = config.deepPageMax - config.deepPageMin + 1;
  const deepPage = String(Math.floor(rng() * range) + config.deepPageMin);
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
  const shuffled = shuffle(candidatePool, rng);

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

async function loadLibraryMbids(): Promise<LibraryLookups> {
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
  albumLibrary: (mbid: string) => AlbumLibraryInfo | null,
  rng: Rng
): Promise<BuiltAlbum | null> {
  return buildExploreResult({
    similarGraph: profile.similarGraph,
    config,
    recentlyShown,
    artistInLibrary,
    albumLibrary,
    rng,
  });
}

/** One recommendation: explore first when the coin says so, within-taste otherwise. */
async function buildOnePick(
  profile: DerivedProfile,
  config: PromotedAlbumConfig,
  excluded: Set<string>,
  library: LibraryLookups,
  rng: Rng
): Promise<BuiltAlbum | null> {
  if (rng() < config.explorationRate) {
    const explored = await buildExplore(
      profile,
      config,
      excluded,
      library.artistInLibrary,
      library.albumLibrary,
      rng
    );
    if (explored) return explored;
  }
  return buildWithinTasteFromProfile(
    profile,
    config,
    excluded,
    library.artistInLibrary,
    library.albumLibrary,
    rng
  );
}

/**
 * Build up to `count` distinct recommendations in one pass. Every pick re-rolls
 * the explore/within-taste coin and adds its album to the exclusion set, so the
 * carousel spans several tags instead of repeating one pool.
 */
async function buildPicks(
  profile: DerivedProfile,
  config: PromotedAlbumConfig,
  recentlyShown: Set<string>,
  library: LibraryLookups,
  count: number,
  rng: Rng
): Promise<BuiltAlbum[]> {
  const picks: BuiltAlbum[] = [];
  const excluded = new Set(recentlyShown);
  const pickedAlbums = new Set<string>();
  const attemptLimit = count + PICK_ATTEMPT_SLACK;

  for (
    let attempt = 0;
    attempt < attemptLimit && picks.length < count;
    attempt += 1
  ) {
    const built = await buildOnePick(profile, config, excluded, library, rng);
    if (!built) continue;

    // Two different ID spaces on purpose: `rememberKey` is the release MBID the source
    // chart returned, which is what exclusion history is keyed on, while the carousel
    // dedups on the release-GROUP MBID the user actually sees.
    excluded.add(built.rememberKey);
    if (pickedAlbums.has(built.result.album.mbid)) continue;

    pickedAlbums.add(built.result.album.mbid);
    picks.push(built);
  }

  return picks;
}

export async function getPromotedAlbums(
  userId: number,
  forceRefresh = false,
  count = SPOTLIGHT_COUNT,
  deps: PromotedAlbumDeps = {}
): Promise<PromotedAlbumEntry[]> {
  const rng = deps.rng ?? Math.random;
  const now = deps.now ?? Date.now;

  const config = getConfigValue("promotedAlbum");
  const resultTtlMs = config.cacheDurationMinutes * 60 * 1000;

  const cached = forceRefresh ? undefined : resultCache.get(userId, now());
  if (cached && cached.length >= count) {
    return cached.slice(0, count);
  }

  const user = await findUserById(userId);
  const plexToken = user?.plexToken;
  if (!plexToken) return [];

  const profile = await loadFreshProfile(userId, plexToken, config);
  if (!profile) return [];

  const library = await loadLibraryMbids();
  const recentAlbums = profile.explorationHistory.albums ?? [];

  const picks = await buildPicks(
    profile,
    config,
    new Set(recentAlbums),
    library,
    count,
    rng
  );
  if (picks.length === 0) return [];

  const rememberKeys = picks.map((p) => p.rememberKey);
  const nextAlbums = [
    ...rememberKeys,
    ...recentAlbums.filter((m) => !rememberKeys.includes(m)),
  ].slice(0, RECENT_SHOWN_LIMIT);
  await updateExplorationHistory(userId, { albums: nextAlbums });

  const results = picks.map((p) => p.result);
  resultCache.set(userId, results, resultTtlMs, now());

  return results;
}
