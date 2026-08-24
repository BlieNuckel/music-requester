import { getTopAlbumsByTag } from "../api/lastfm/albums";
import type { LidarrAlbum } from "../api/lidarr/types";
import { resolveReleaseGroupInfo } from "../api/musicbrainz/releaseGroups";
import type { MbPriority } from "../api/musicbrainz/queue";
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
import {
  getPromotedAlbumSnapshot,
  savePromotedAlbumSnapshot,
  type StoredCarousel,
} from "../db/promotedAlbumSnapshot";
import type { DerivedProfile } from "../db/entity/UserProfile";
import { getMonitoredAlbums } from "../services/lidarr/albums";
import { getArtistList } from "../services/lidarr/artists";
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
  artistGenreUnits,
  type GenreUnit,
} from "./profileService";
import type {
  BuiltAlbum,
  ResolutionBudget,
  PromotedAlbumEntry,
  WithinTasteResult,
  WithinTasteTrace,
  TraceArtistEntry,
  TraceArtistTagContribution,
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

/**
 * A cached carousel plus the batch size the build was aiming for. The two differ whenever
 * a build came up short, and a later request asking for more than the build ever tried for
 * has to rebuild rather than be served a batch that was never going to satisfy it.
 */
type CachedCarousel = { albums: PromotedAlbumEntry[]; targetCount: number };

/** Everything one build needs, so the fallback path can retry-or-fall-back around it. */
type BuildRequest = {
  userId: number;
  count: number;
  config: PromotedAlbumConfig;
  plexToken: string;
  rng: Rng;
  source: PromotedAlbumSource;
};

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
  priority: MbPriority;
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
 * Who asked for a carousel. A warmer build is nobody waiting on it, so it takes the
 * background MusicBrainz lane and does not count as the user visiting Discover —
 * otherwise warming would keep renewing its own reason to run.
 */
export type PromotedAlbumSource = "request" | "warmer";

/**
 * Injected clock and randomness. Both default to the globals; tests pass their own so
 * the selection rules (how often we explore, how deep we page) can be asserted directly
 * instead of stubbing `Math.random` for every decision at once.
 */
export type PromotedAlbumDeps = {
  rng?: Rng;
  now?: () => number;
  source?: PromotedAlbumSource;
};

/** How many recommendations the spotlight carousel presents. */
export const SPOTLIGHT_COUNT = 5;

/** Spare attempts so dead tags or duplicate picks don't shorten the carousel. */
const PICK_ATTEMPT_SLACK = 3;

const RECENT_SHOWN_LIMIT = 25;

/** Paced MusicBrainz lookups one carousel build may spend across all of its picks. */
const RESOLUTION_BUDGET = 30;

const log = createLogger("promoted-album");

/**
 * How long after a real Discover load a user still counts as worth pre-warming.
 * Deliberately much tighter than the profile regen window: a profile is expensive
 * and describes a taste that outlives a week of absence, while a carousel is cheap
 * to rebuild and only worth having ready for someone likely to look at it today.
 */
const WARM_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * How long a build that came up short — or one that had to fall back to the stored
 * carousel — is trusted before another load retries it. Short, because the shortfall is
 * usually a MusicBrainz wobble rather than a fact about the user; but not zero, because
 * retrying a failing 30-lookup build on every page load is how one outage becomes a
 * self-inflicted one.
 */
const PARTIAL_RESULT_TTL_MS = 5 * 60 * 1000;

/** Short-lived final-result cache (layer 2) — keeps album selection off MusicBrainz on every load. */
const resultCache = createTtlMap<number, CachedCarousel>();

/** Last time each user loaded the carousel themselves; warmer builds never register here. */
const lastRequestedAt = createTtlMap<number, number>();

export function clearPromotedAlbumCache() {
  resultCache.clear();
  lastRequestedAt.clear();
}

/** Users who loaded the carousel recently enough that keeping it warm is worth the quota. */
export function listWarmableUsers(now: number = Date.now()): number[] {
  return lastRequestedAt.keys(now);
}

/** When a user's cached carousel expires, or undefined when they have none. */
export function promotedAlbumCacheExpiry(
  userId: number,
  now: number = Date.now()
): number | undefined {
  return resultCache.expiresAt(userId, now);
}

/** A profile's albums indexed by the artist whose weight they carry a share of. */
function groupAlbumsByArtist(
  albumTags: DerivedProfile["albumTags"]
): Map<string, GenreUnit[]> {
  const byArtist = new Map<string, GenreUnit[]>();
  for (const album of albumTags) {
    const existing = byArtist.get(album.artistName);
    if (existing) existing.push(album);
    else byArtist.set(album.artistName, [album]);
  }
  return byArtist;
}

/**
 * One artist's tag contributions as they actually reached the vector — summed across that
 * artist's albums, because the album is what carries the weight now. `rawCount` is the
 * highest count the tag was seen with, which is all the trace does with it.
 *
 * An artist with no stored albums falls back to its own tags, which is both the pre-album
 * shape and what the vector itself falls back to.
 */
function tagContributions(
  artist: DerivedProfile["artistTags"][number],
  albums: GenreUnit[] | undefined
): TraceArtistTagContribution[] {
  const units: GenreUnit[] =
    albums && albums.length > 0
      ? albums
      : [
          {
            artistName: artist.name,
            weight: artist.viewCount,
            tags: artist.tags,
          },
        ];

  const merged = new Map<string, TraceArtistTagContribution>();
  for (const unit of units) {
    const weights = normalizedTagWeights(unit.tags, unit.weight);
    for (const [index, tag] of unit.tags.entries()) {
      const key = tag.name.toLowerCase();
      const existing = merged.get(key);
      if (existing) {
        existing.weight += weights[index];
        existing.rawCount = Math.max(existing.rawCount, tag.count);
      } else {
        merged.set(key, {
          tagName: tag.name,
          rawCount: tag.count,
          weight: weights[index],
        });
      }
    }
  }
  return Array.from(merged.values());
}

function buildTraceFromProfile(inputs: TraceInputs): WithinTasteTrace {
  const { profile, sampledNames, vector, chosenTag } = inputs;

  const albumsByArtistName = groupAlbumsByArtist(profile.albumTags);

  const plexArtists: TraceArtistEntry[] = profile.artistTags.map((a) => {
    return {
      name: a.name,
      viewCount: a.viewCount,
      picked: sampledNames.has(a.name),
      tagContributions: tagContributions(a, albumsByArtistName.get(a.name)),
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
 * What this pick's vector is summed from: the sampled artists' albums, since that is where
 * genre attaches. The artists themselves stand in for a profile stored before album tags
 * existed — the vector that comes out is then exactly the one that profile was built from.
 */
function sampledGenreUnits(
  profile: DerivedProfile,
  sampled: DerivedProfile["artistTags"]
): GenreUnit[] {
  const names = new Set(sampled.map((a) => a.name));
  const albums = profile.albumTags.filter((a) => names.has(a.artistName));
  return albums.length > 0 ? albums : artistGenreUnits(sampled);
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
 * Resolve one candidate, treating a failed lookup the same as an unknown release group.
 * MusicBrainz answers 429/503 under load, and `mbJson` rightly throws on those rather than
 * caching them as "this album does not exist" — but a build must not die of it. Losing one
 * candidate costs one slot of a 30-lookup budget; letting the error out costs the carousel.
 */
async function resolveOrNull(
  getRgInfo: GetRgInfo,
  mbid: string
): Promise<ReleaseGroupInfo | null> {
  try {
    return await getRgInfo(mbid);
  } catch (error) {
    log.debug(`Candidate ${mbid} could not be resolved`, error);
    return null;
  }
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

    const rgInfo = await resolveOrNull(walk.getRgInfo, album.mbid);
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
  const units = sampledGenreUnits(profile, sampled);
  const vector =
    units.length > 0 ? buildGenreVector(units) : profile.genreVector;

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
    (mbid) => resolveReleaseGroupInfo(mbid, ctx.priority),
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
      getArtistList(),
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
    priority: ctx.priority,
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
    priority: ctx.priority,
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
 * One pick, with its failures contained to itself. Every source behind a pick reaches at
 * least one external service, so any of them can throw — and an uncaught throw here used
 * to discard the picks already built alongside it and fail the whole request. A dead pick
 * costs one attempt out of {@link PICK_ATTEMPT_SLACK} spare ones instead.
 */
async function tryOnePick(
  ctx: PickContext,
  excluded: Set<string>,
  explore: boolean
): Promise<BuiltAlbum | null> {
  try {
    return await buildOnePick(ctx, excluded, explore);
  } catch (error) {
    log.warn("Pick failed; continuing with the rest of the carousel", error);
    return null;
  }
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

    const built = await tryOnePick(ctx, excluded, explore);
    if (!built) continue;

    excluded.add(built.rememberKey);
    if (pickedAlbums.has(built.result.album.mbid)) continue;

    pickedAlbums.add(built.result.album.mbid);
    picks.push(built);
  }

  return picks;
}

/** A cached batch big enough to answer this request, or undefined. */
function cachedCarousel(
  userId: number,
  count: number,
  now: number
): PromotedAlbumEntry[] | undefined {
  const entry = resultCache.get(userId, now);
  if (!entry || entry.targetCount < count) return undefined;
  return entry.albums.slice(0, count);
}

/**
 * How long a batch deserves to be trusted: a full one for the configured duration, a short
 * one only until {@link PARTIAL_RESULT_TTL_MS} lets a load try again. Without the second
 * case a build that came up short was re-attempted on every single page load, which is the
 * most expensive possible response to a temporary shortfall.
 */
function carouselTtlMs(
  albumCount: number,
  targetCount: number,
  resultTtlMs: number
): number {
  return albumCount >= targetCount
    ? resultTtlMs
    : Math.min(resultTtlMs, PARTIAL_RESULT_TTL_MS);
}

function rememberCarousel(
  userId: number,
  albums: PromotedAlbumEntry[],
  targetCount: number,
  ttlMs: number,
  now: number
): void {
  resultCache.set(userId, { albums, targetCount }, ttlMs, now);
}

/**
 * A stored carousel still inside its lifetime holds exactly what the in-memory entry held
 * before the process that wrote it exited, so serving it is not staleness — it is the
 * layer-2 cache surviving a restart. Only a batch that aimed at least as high as this
 * request qualifies, same rule as the in-memory entry, and a stored batch that came up
 * short lapses on the same short clock its in-memory twin would have.
 */
function snapshotIsFresh(
  stored: StoredCarousel,
  count: number,
  resultTtlMs: number,
  now: number
): boolean {
  const lifetimeMs = carouselTtlMs(
    stored.albums.length,
    stored.targetCount,
    resultTtlMs
  );
  return stored.targetCount >= count && now - stored.builtAt < lifetimeMs;
}

/**
 * Select a fresh batch. Profile construction never runs inside this call: a cold start walks
 * every played track in the Plex library and resolves every seed against MusicBrainz at
 * ~1 req/sec, which is minutes of work. It is started in the background instead, and the
 * caller shows that the profile is being built rather than an empty page indistinguishable
 * from "no results".
 */
async function buildCarousel(req: BuildRequest): Promise<PromotedAlbumsResult> {
  const load = await loadProfileForRequest(
    req.userId,
    req.plexToken,
    req.config
  );
  if (load.status === "building") return { status: "building", albums: [] };
  const profile = load.profile;

  const recentAlbums = profile.explorationHistory.albums ?? [];
  const ctx: PickContext = {
    profile,
    config: req.config,
    library: await loadLibraryMbids(),
    budget: { remaining: RESOLUTION_BUDGET },
    rng: req.rng,
    priority: req.source === "warmer" ? "background" : "interactive",
  };

  const picks = await buildPicks(ctx, new Set(recentAlbums), req.count);
  if (picks.length === 0) return { status: "ready", albums: [] };

  const rememberKeys = picks.map((p) => p.rememberKey);
  const nextAlbums = [
    ...rememberKeys,
    ...recentAlbums.filter((m) => !rememberKeys.includes(m)),
  ].slice(0, RECENT_SHOWN_LIMIT);
  await updateExplorationHistory(req.userId, { albums: nextAlbums });

  return { status: "ready", albums: picks.map((p) => p.result) };
}

/**
 * Build, and keep whatever the last successful build produced when this one cannot deliver.
 * MusicBrainz refuses often enough under load that a build failing is normal operation,
 * and the alternative to yesterday's five albums is a Discover page with a hole in it.
 */
async function buildOrServeStored(
  req: BuildRequest,
  stored: StoredCarousel | null,
  resultTtlMs: number,
  now: number
): Promise<PromotedAlbumsResult> {
  try {
    const built = await buildCarousel(req);
    if (built.status === "building") return built;

    if (built.albums.length > 0) {
      rememberCarousel(
        req.userId,
        built.albums,
        req.count,
        carouselTtlMs(built.albums.length, req.count, resultTtlMs),
        now
      );
      await savePromotedAlbumSnapshot(req.userId, built.albums, req.count, now);
      return built;
    }
  } catch (error) {
    log.error(`Carousel build failed for user ${req.userId}`, error);
  }

  if (!stored) return { status: "ready", albums: [] };

  log.info(`Serving the stored carousel for user ${req.userId}`);
  const albums = stored.albums.slice(0, req.count);
  // Deliberately the short clock even for a complete batch: this one is being served past
  // its own lifetime, so the next load should try again soon — just not immediately.
  rememberCarousel(
    req.userId,
    albums,
    req.count,
    Math.min(resultTtlMs, PARTIAL_RESULT_TTL_MS),
    now
  );
  return { status: "ready", albums };
}

/**
 * The carousel's recommendations, or `building` when the user has no usable profile yet.
 * Answers from the in-memory batch first, then from the stored one while it is still
 * inside its TTL, and only then builds — so a restart does not make the next visitor pay
 * for a rebuild, and a rebuild that fails falls back to the stored batch instead of
 * returning nothing.
 */
export async function getPromotedAlbums(
  userId: number,
  forceRefresh = false,
  count = SPOTLIGHT_COUNT,
  deps: PromotedAlbumDeps = {}
): Promise<PromotedAlbumsResult> {
  const rng = deps.rng ?? Math.random;
  const nowFn = deps.now ?? Date.now;
  const source = deps.source ?? "request";

  const config = getConfigValue("promotedAlbum");
  const resultTtlMs = config.cacheDurationMinutes * 60 * 1000;
  const now = nowFn();

  if (source === "request") {
    lastRequestedAt.set(userId, now, WARM_ACTIVITY_WINDOW_MS, now);
  }

  if (!forceRefresh) {
    const cached = cachedCarousel(userId, count, now);
    if (cached) return { status: "ready", albums: cached };
  }

  const user = await findUserById(userId);
  const plexToken = user?.plexToken;
  if (!plexToken) return { status: "ready", albums: [] };

  const stored = await getPromotedAlbumSnapshot(userId);
  if (
    !forceRefresh &&
    stored &&
    snapshotIsFresh(stored, count, resultTtlMs, now)
  ) {
    const lifetimeMs = carouselTtlMs(
      stored.albums.length,
      stored.targetCount,
      resultTtlMs
    );
    rememberCarousel(
      userId,
      stored.albums,
      stored.targetCount,
      lifetimeMs - (now - stored.builtAt),
      now
    );
    return { status: "ready", albums: stored.albums.slice(0, count) };
  }

  return buildOrServeStored(
    { userId, count, config, plexToken, rng, source },
    stored,
    resultTtlMs,
    now
  );
}
