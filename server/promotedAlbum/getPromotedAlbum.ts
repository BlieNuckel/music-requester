import type { LidarrAlbum } from "../api/lidarr/types";
import { getConfigValue } from "../config";
import { deriveAlbumLibraryInfo } from "../../shared/albumLibrary";
import type { PromotedAlbumConfig } from "../config";
import type { Rng } from "../utils/random";
import { createTtlMap } from "../utils/ttlMap";
import { findUserById } from "../auth/users";
import {
  getPromotedAlbumSnapshot,
  savePromotedAlbumSnapshot,
  type StoredCarousel,
} from "../db/promotedAlbumSnapshot";
import { getMonitoredAlbums } from "../services/lidarr/albums";
import { getArtistList } from "../services/lidarr/artists";
import { createLogger } from "../logger";
import { runGraph } from "../recommenderGraph/runtime/executor";
import { RESOLUTION_BUDGET } from "./budget";
import { PICK_BODIES, type PickCtx } from "./pickGraph";
import { loadProfileForRequest } from "./profileService";
import type { BuiltAlbum, LibraryLookups, PromotedAlbumEntry } from "./types";

export type { PromotedAlbumResult, PromotedAlbumEntry } from "./types";

/** Carousel payload plus whether the profile behind it exists yet. */
export type PromotedAlbumsResult = {
  status: "ready" | "building";
  albums: PromotedAlbumEntry[];
};

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
 * Select a fresh batch, by running the spotlight flow of the declared recommender graph.
 * The wiring is the graph's: this asks for `antiRepeat` and gets back whatever the nodes
 * feeding it produced, which is what stops the picture on the settings page and the code
 * that picks albums from describing two different pipelines.
 *
 * Profile construction never runs inside this call: a cold start walks every played track in
 * the Plex library and resolves every seed against MusicBrainz at ~1 req/sec, which is
 * minutes of work. It is started in the background instead, and the caller shows that the
 * profile is being built rather than an empty page indistinguishable from "no results".
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
  const ctx: PickCtx = {
    userId: req.userId,
    config: req.config,
    library: await loadLibraryMbids(),
    budget: { remaining: RESOLUTION_BUDGET },
    rng: req.rng,
    priority: req.source === "warmer" ? "background" : "interactive",
    count: req.count,
    recentAlbums,
    excluded: new Set(recentAlbums),
    exploring: false,
  };

  const { outputs } = await runGraph(
    ["antiRepeat"],
    PICK_BODIES,
    ctx,
    new Map([["profileFreshness", profile]])
  );

  const picks = (outputs.get("antiRepeat") ?? []) as BuiltAlbum[];
  return { status: "ready", albums: picks.map((pick) => pick.result) };
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
