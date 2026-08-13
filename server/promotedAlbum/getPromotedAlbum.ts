import { getTopAlbumsByTag } from "../api/lastfm/albums";
import { lidarrGet } from "../api/lidarr/get";
import type { LidarrAlbum, LidarrArtist } from "../api/lidarr/types";
import { resolveReleaseGroupInfo } from "../api/musicbrainz/releaseGroups";
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
import { isAllowedReleaseType } from "../services/discover/typeFilter";
import { createLogger } from "../logger";
import { buildExploreResult } from "./explore";
import { buildPersonalResult } from "./personal";
import { preferenceRule, orderByPreference } from "./preference";
import type { PreferenceRule } from "./preference";
import {
  loadProfileForRequest,
  normalizedTagWeights,
  buildGenreVector,
} from "./profileService";
import type {
  BuiltAlbum,
  ResolutionBudget,
  PromotedAlbumEntry,
  WithinTasteResult,
  WithinTasteTrace,
  TraceArtistEntry,
  TraceAlbumPoolInfo,
  TraceSelectionReason,
  TraceWeightedTag,
} from "./types";

export type { PromotedAlbumResult, PromotedAlbumEntry } from "./types";

/** Carousel payload plus whether the profile behind it exists yet. */
export type PromotedAlbumsResult = {
  status: "ready" | "building";
  albums: PromotedAlbumEntry[];
};

type WeightedTag = { name: string; weight: number };

type LibraryLookups = {
  artistInLibrary: (mbid: string) => boolean;
  albumLibrary: (mbid: string) => AlbumLibraryInfo | null;
};

/** What the within-taste trace explains: the sample drawn, the vector it produced, the pick. */
type TraceInputs = {
  profile: DerivedProfile;
  sampledNames: Set<string>;
  vector: DerivedProfile["genreVector"];
  chosenTag: WeightedTag;
  albumPool: TraceAlbumPoolInfo;
  selectionReason: TraceSelectionReason;
};

/** Everything one carousel build shares across its picks, including the spend budget. */
type PickContext = {
  profile: DerivedProfile;
  config: PromotedAlbumConfig;
  library: LibraryLookups;
  budget: ResolutionBudget;
  rng: Rng;
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

type SelectionWalk = PreferenceRule & {
  candidates: CandidateAlbum[];
  getRgInfo: GetRgInfo;
  recentlyShown: Set<string>;
  budget: ResolutionBudget;
};

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

/** Paced MusicBrainz lookups one carousel build may spend across all of its picks. */
const RESOLUTION_BUDGET = 30;

const log = createLogger("promoted-album");

/** Short-lived final-result cache (layer 2) — keeps album selection off MusicBrainz on every load. */
const resultCache = createTtlMap<number, PromotedAlbumEntry[]>();

export function clearPromotedAlbumCache() {
  resultCache.clear();
}

function buildTraceFromProfile(inputs: TraceInputs): WithinTasteTrace {
  const { profile, sampledNames, vector, chosenTag } = inputs;

  const plexArtists: TraceArtistEntry[] = profile.artistTags.map((a) => {
    const weights = normalizedTagWeights(a.tags, a.viewCount);
    return {
      name: a.name,
      viewCount: a.viewCount,
      picked: sampledNames.has(a.name),
      tagContributions: a.tags.map((t, index) => ({
        tagName: t.name,
        rawCount: t.count,
        weight: weights[index],
      })),
      distinctTracksPlayed: a.distinctTracksPlayed,
      topTrackShare: a.topTrackShare,
      distributionFactor: a.distributionFactor,
      ratingBreadth: a.ratingBreadth,
      ratingMultiplier: a.ratingMultiplier,
      availableTracks: a.availableTracks,
    };
  });

  const weightedTags: TraceWeightedTag[] = vector.map((g) => ({
    name: g.tag,
    weight: g.weight,
    fromArtists: g.fromArtists,
  }));

  return {
    kind: "within_taste",
    plexArtists,
    weightedTags,
    chosenTag: { name: chosenTag.name, weight: chosenTag.weight },
    albumPool: inputs.albumPool,
    selectionReason: inputs.selectionReason,
  };
}

/**
 * The artists one recommendation is drawn from, re-sampled per pick and weighted by play
 * weight. The sample used to happen at regeneration time, which froze one draw of three
 * artists into the profile and let it shape every recommendation for the whole 24h TTL.
 * Drawing here instead means a day's carousel spans the user's whole top-artist set, and
 * two picks in the same batch can come from different corners of it.
 */
function sampleArtists(
  artistTags: DerivedProfile["artistTags"],
  count: number,
  rng: Rng
): DerivedProfile["artistTags"] {
  return weightedRandomPick(artistTags, (a) => a.viewCount, count, rng);
}

/**
 * Preferred candidates first, then the rest. The preference reads `artistMbid`, which the
 * chart already carries, so ordering the pool by it costs nothing — whereas evaluating it
 * *after* resolving each candidate is what used to walk a whole 100-album pool through
 * paced MusicBrainz lookups whenever the pool was mostly library artists.
 */
function orderCandidates(walk: SelectionWalk): CandidateAlbum[] {
  return orderByPreference(walk.candidates, (a) => a.artistMbid, walk);
}

/**
 * Take the first album that resolves to a release group, is a release type worth
 * recommending, and hasn't been shown recently. Candidates are visited in preference order,
 * so the first qualifying one is also the most preferred available and the walk can stop
 * there; a greatest-hits package or a live album is not an album recommendation, and the
 * type only becomes known once the candidate has been resolved.
 *
 * The shared {@link ResolutionBudget} bounds how many MusicBrainz lookups the whole build
 * may spend: without it, a pool of unresolvable MBIDs walks the full pool per pick and every
 * pick attempt pays it again.
 */
async function walkCandidates(
  walk: SelectionWalk
): Promise<AlbumSelection | null> {
  for (const album of orderCandidates(walk)) {
    if (walk.budget.remaining <= 0) {
      log.debug("Resolution budget spent; giving up on this pick");
      return null;
    }
    walk.budget.remaining -= 1;

    const rgInfo = await walk.getRgInfo(album.mbid);
    if (!rgInfo) continue;
    if (!isAllowedReleaseType(rgInfo.primaryType, rgInfo.secondaryTypes)) {
      continue;
    }
    if (walk.recentlyShown.has(rgInfo.id)) continue;

    return {
      album,
      rgMbid: rgInfo.id,
      year: rgInfo.firstReleaseDate.slice(0, 4),
      reason: walk.isPreferred(album.artistMbid)
        ? walk.preferredReason
        : walk.fallbackReason,
    };
  }

  return null;
}

/**
 * Anti-repeat runs inside the walk rather than over the raw pool because the memory is keyed
 * on release-group MBIDs, and a Last.fm chart entry only has one after it is resolved. When
 * every qualifying candidate turns out to be recently shown, the walk repeats without the
 * memory — a repeat beats an empty slot, and the second pass is served entirely from the
 * MusicBrainz cache the first one filled.
 */
async function selectAlbum(
  shuffled: CandidateAlbum[],
  artistInLibrary: (mbid: string) => boolean,
  libraryPreference: LibraryPreference,
  getRgInfo: GetRgInfo,
  recentlyShown: Set<string>,
  budget: ResolutionBudget
): Promise<AlbumSelection | null> {
  const walk: SelectionWalk = {
    candidates: shuffled,
    getRgInfo,
    recentlyShown,
    budget,
    ...preferenceRule(libraryPreference, artistInLibrary),
  };

  const picked = await walkCandidates(walk);
  if (picked || recentlyShown.size === 0) return picked;
  return walkCandidates({ ...walk, recentlyShown: new Set() });
}

/**
 * Per-request within-taste selection off the persisted profile: sample a few of the user's
 * top artists, build this pick's genre vector from their tags, draw a tag from it, fetch a
 * fresh album pool and select an album. The expensive Plex + Last.fm fan-out is NOT re-run
 * here — that lives in the profile, which now stores every top artist's tags so the sample
 * can be drawn per pick.
 *
 * A profile written before the artists were stored in full falls back to its stored vector,
 * which is the same thing built from whatever sample that profile froze.
 */
async function buildWithinTasteFromProfile(
  ctx: PickContext,
  recentlyShown: Set<string>
): Promise<BuiltAlbum | null> {
  const { profile, config, rng } = ctx;

  const sampled = sampleArtists(
    profile.artistTags,
    config.pickedArtistsCount,
    rng
  );
  const vector =
    sampled.length > 0 ? buildGenreVector(sampled) : profile.genreVector;

  const weightedTags: WeightedTag[] = vector.map((g) => ({
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

  const picked = await selectAlbum(
    shuffle(allAlbums, rng),
    ctx.library.artistInLibrary,
    config.libraryPreference,
    resolveReleaseGroupInfo,
    recentlyShown,
    ctx.budget
  );
  if (!picked) return null;

  const albumPoolInfo: TraceAlbumPoolInfo = {
    page1Count: page1.albums.length,
    deepPage: Number(deepPage),
    deepPageCount: pageDeep.albums.length,
    totalAfterDedup: allAlbums.length,
  };

  const trace = buildTraceFromProfile({
    profile,
    sampledNames: new Set(sampled.map((a) => a.name)),
    vector,
    chosenTag,
    albumPool: albumPoolInfo,
    selectionReason: picked.reason,
  });

  const library = ctx.library.albumLibrary(picked.rgMbid);

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

  return { result, rememberKey: picked.rgMbid };
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
  ctx: PickContext,
  recentlyShown: Set<string>
): Promise<BuiltAlbum | null> {
  return buildExploreResult({
    similarGraph: ctx.profile.similarGraph,
    config: ctx.config,
    recentlyShown,
    artistInLibrary: ctx.library.artistInLibrary,
    albumLibrary: ctx.library.albumLibrary,
    budget: ctx.budget,
    rng: ctx.rng,
  });
}

function buildPersonal(
  ctx: PickContext,
  recentlyShown: Set<string>
): Promise<BuiltAlbum | null> {
  return buildPersonalResult({
    similarGraph: ctx.profile.similarGraph,
    knownAlbums: new Set(ctx.profile.knownAlbums),
    config: ctx.config,
    recentlyShown,
    artistInLibrary: ctx.library.artistInLibrary,
    albumLibrary: ctx.library.albumLibrary,
    budget: ctx.budget,
    rng: ctx.rng,
  });
}

/**
 * One recommendation: a genre jump when this slot is an explore slot, then the adjacent band
 * off the user's own graph, and the genre's global album chart only when neither produced
 * anything. The tag path is the fallback rather than the default because it knows nothing
 * about this user past one tag string — but it is also the only source that works before a
 * graph exists, so it stays.
 */
async function buildOnePick(
  ctx: PickContext,
  excluded: Set<string>,
  explore: boolean
): Promise<BuiltAlbum | null> {
  if (explore) {
    const explored = await buildExplore(ctx, excluded);
    if (explored) return explored;
  }

  const personal = await buildPersonal(ctx, excluded);
  if (personal) return personal;

  return buildWithinTasteFromProfile(ctx, excluded);
}

/**
 * How many of this build's picks attempt a genre jump. `explorationRate` used to be a coin
 * re-flipped per pick, which let a five-album carousel come back all jumps or none by chance;
 * as a quota over the build it is the proportion it reads as, and every carousel spans both
 * bands. The fractional remainder stays a coin so the dial still means something for a single
 * pick.
 */
function exploreSlots(rate: number, count: number, rng: Rng): number {
  const exact = Math.min(1, Math.max(0, rate)) * count;
  const whole = Math.floor(exact);
  return whole + (rng() < exact - whole ? 1 : 0);
}

/**
 * Build up to `count` distinct recommendations in one pass. The explore slots are allocated
 * up front rather than re-rolled per pick, and every pick adds its album to the exclusion
 * set, so the carousel spans both bands instead of repeating one pool. A slot is spent when
 * its attempt is made: an explore slot that yields nothing falls through to the adjacent band
 * rather than making every later attempt retry the same empty graph corner.
 */
async function buildPicks(
  ctx: PickContext,
  recentlyShown: Set<string>,
  count: number
): Promise<BuiltAlbum[]> {
  const picks: BuiltAlbum[] = [];
  const excluded = new Set(recentlyShown);
  const pickedAlbums = new Set<string>();
  const attemptLimit = count + PICK_ATTEMPT_SLACK;
  let exploresLeft = exploreSlots(ctx.config.explorationRate, count, ctx.rng);

  for (
    let attempt = 0;
    attempt < attemptLimit && picks.length < count;
    attempt += 1
  ) {
    const explore = exploresLeft > 0;
    if (explore) exploresLeft -= 1;

    const built = await buildOnePick(ctx, excluded, explore);
    if (!built) continue;

    excluded.add(built.rememberKey);
    if (pickedAlbums.has(built.result.album.mbid)) continue;

    pickedAlbums.add(built.result.album.mbid);
    picks.push(built);
  }

  return picks;
}

/**
 * The carousel's recommendations, or `building` when the user has no usable profile yet.
 * Profile construction never runs inside this call: a cold start walks every played track
 * in the Plex library and resolves every seed against MusicBrainz at ~1 req/sec, which is
 * minutes of work. It is started in the background instead, and the caller shows that the
 * profile is being built rather than an empty page indistinguishable from "no results".
 */
export async function getPromotedAlbums(
  userId: number,
  forceRefresh = false,
  count = SPOTLIGHT_COUNT,
  deps: PromotedAlbumDeps = {}
): Promise<PromotedAlbumsResult> {
  const rng = deps.rng ?? Math.random;
  const now = deps.now ?? Date.now;

  const config = getConfigValue("promotedAlbum");
  const resultTtlMs = config.cacheDurationMinutes * 60 * 1000;

  const cached = forceRefresh ? undefined : resultCache.get(userId, now());
  if (cached && cached.length >= count) {
    return { status: "ready", albums: cached.slice(0, count) };
  }

  const user = await findUserById(userId);
  const plexToken = user?.plexToken;
  if (!plexToken) return { status: "ready", albums: [] };

  const load = await loadProfileForRequest(userId, plexToken, config);
  if (load.status === "building") return { status: "building", albums: [] };
  const profile = load.profile;

  const recentAlbums = profile.explorationHistory.albums ?? [];
  const ctx: PickContext = {
    profile,
    config,
    library: await loadLibraryMbids(),
    budget: { remaining: RESOLUTION_BUDGET },
    rng,
  };

  const picks = await buildPicks(ctx, new Set(recentAlbums), count);
  if (picks.length === 0) return { status: "ready", albums: [] };

  const rememberKeys = picks.map((p) => p.rememberKey);
  const nextAlbums = [
    ...rememberKeys,
    ...recentAlbums.filter((m) => !rememberKeys.includes(m)),
  ].slice(0, RECENT_SHOWN_LIMIT);
  await updateExplorationHistory(userId, { albums: nextAlbums });

  const results = picks.map((p) => p.result);
  resultCache.set(userId, results, resultTtlMs, now());

  return { status: "ready", albums: results };
}
