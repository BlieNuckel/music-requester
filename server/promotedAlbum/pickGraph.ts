import type { MbPriority } from "../api/musicbrainz/queue";
import type { PromotedAlbumConfig } from "../config";
import { updateExplorationHistory } from "../db/userProfile";
import type {
  DerivedProfile,
  SimilarGraphSeed,
} from "../db/entity/UserProfile";
import { createLogger } from "../logger";
import {
  fallbackOrder,
  type NodeBody,
  type NodeInputs,
  type NodeRuntime,
} from "../recommenderGraph/runtime/executor";
import type {
  NodeRun,
  RecommendationTrace,
} from "../../shared/recommendationTrace";
import { RESOLUTION_BUDGET, RESOLUTION_BUDGET_LABEL } from "./budget";
import type { Rng } from "../utils/random";
import {
  drawExploreSeed,
  pickExploreAlbum,
  rankDistantNeighbours,
  type ExploreBand,
} from "./explore";
import {
  collectCandidates,
  pickPersonalAlbum,
  preferredPool,
  withinTastePool,
  type PersonalBand,
  type PersonalCandidate,
} from "./personal";
import { preferenceRule, type PreferenceRule } from "./preference";
import {
  buildPickVector,
  drawTag,
  fetchTagAlbumPool,
  sampleArtists,
  walkTagPool,
  type DrawnTag,
  type SampledVector,
  type TagAlbumPool,
} from "./tagChart";
import type {
  BuiltAlbum,
  LibraryLookups,
  PickedAlbum,
  ResolutionBudget,
  TracedAlbum,
} from "./types";

/**
 * Everything one carousel build shares across its picks. The mutable fields are the reason
 * the pick flow needs combinator nodes at all: the budget is one allowance every source
 * spends from, the exclusion set grows as the build fills up, and whether the attempt now
 * running is an explore slot is a decision the loop makes and the explore branch reads.
 */
export type PickCtx = {
  userId: number;
  config: PromotedAlbumConfig;
  library: LibraryLookups;
  budget: ResolutionBudget;
  rng: Rng;
  priority: MbPriority;
  /** How many recommendations this build is aiming for. */
  count: number;
  /** What earlier builds already showed this user, newest first. */
  recentAlbums: string[];
  /** Release groups this build will not show: `recentAlbums`, plus its own picks as it goes. */
  excluded: Set<string>;
  /** Whether the attempt now running was granted a genre jump. */
  exploring: boolean;
};

/** Spare attempts so dead tags or duplicate picks don't shorten the carousel. */
const PICK_ATTEMPT_SLACK = 3;

const RECENT_SHOWN_LIMIT = 25;

const log = createLogger("promoted-album");

/** Which node's output becomes a recommendation of each mode, so a trace can say which. */
export const SOURCE_NODES: Record<PickedAlbum["mode"], string> = {
  explore: "exploreAlbum",
  personal: "personalAlbum",
  within_taste: "candidateWalk",
};

export const profileOf = (inputs: NodeInputs): DerivedProfile =>
  inputs.profileFreshness as DerivedProfile;

export const ruleOf = (ctx: PickCtx): PreferenceRule =>
  preferenceRule(ctx.config.libraryPreference, ctx.library.artistInLibrary);

/** What the two graph sources need to turn a chosen artist into an album. */
const albumCtx = (ctx: PickCtx) => ({
  recentlyShown: ctx.excluded,
  artistInLibrary: ctx.library.artistInLibrary,
  albumLibrary: ctx.library.albumLibrary,
  budget: ctx.budget,
  rng: ctx.rng,
  priority: ctx.priority,
});

/**
 * How many of this build's picks attempt a genre jump. `explorationRate` used to be a coin
 * re-flipped per pick, which let a five-album carousel come back all jumps or none by chance;
 * as a quota over the build it is the proportion it reads as, and every carousel spans both
 * bands. The fractional remainder stays a coin so the dial still means something for a single
 * pick.
 */
export function exploreSlots(rate: number, count: number, rng: Rng): number {
  const exact = Math.min(1, Math.max(0, rate)) * count;
  const whole = Math.floor(exact);
  return whole + (rng() < exact - whole ? 1 : 0);
}

/**
 * One attempt, with its failures contained to itself. Every source behind a pick reaches at
 * least one external service, so any of them can throw — and an uncaught throw here used to
 * discard the picks already built alongside it and fail the whole request. A dead attempt
 * costs one of {@link PICK_ATTEMPT_SLACK} spare ones instead.
 */
async function tryAttempt(
  runtime: NodeRuntime
): Promise<{ built: BuiltAlbum | null; trace: NodeRun[] }> {
  try {
    const { value, trace } = await runtime.traced("sourceChain");
    return { built: value as BuiltAlbum | null, trace };
  } catch (error) {
    log.warn("Pick failed; continuing with the rest of the carousel", error);
    return { built: null, trace: [] };
  }
}

/**
 * The record of the turns this one recommendation took. The quota's turn is prepended
 * because it is what decided whether this slot was allowed a genre jump, and it runs once
 * for the build rather than once per attempt.
 */
function traced(
  built: BuiltAlbum,
  ctx: PickCtx,
  nodes: NodeRun[]
): TracedAlbum {
  const trace: RecommendationTrace = {
    source: SOURCE_NODES[built.result.mode],
    nodes,
    budget: {
      label: RESOLUTION_BUDGET_LABEL,
      remaining: ctx.budget.remaining,
      of: RESOLUTION_BUDGET,
    },
  };
  return { ...built, result: { ...built.result, trace } };
}

/**
 * One body per node in the carousel build.
 *
 * Three of them are combinators rather than steps: `exploreQuota` rations, `sourceChain`
 * orders, `pickLoop` repeats. Between them they are why the runtime grew a `resolve`: whether
 * a source runs at all, and how many times, is the whole content of those nodes, and a
 * runtime that settled every input before the body started would settle it for them.
 */
export const PICK_BODIES: ReadonlyMap<string, NodeBody<PickCtx>> = new Map<
  string,
  NodeBody<PickCtx>
>([
  [
    "exploreQuota",
    (_inputs, ctx) =>
      exploreSlots(ctx.config.explorationRate, ctx.count, ctx.rng),
  ],

  [
    "exploreSeed",
    (inputs, ctx) =>
      ctx.exploring
        ? drawExploreSeed(profileOf(inputs).similarGraph, ctx.rng)
        : null,
  ],

  [
    "exploreBand",
    (inputs, ctx) => {
      const seed = inputs.exploreSeed as SimilarGraphSeed | null;
      return seed
        ? rankDistantNeighbours(
            seed,
            ctx.config.genreOverlapThreshold,
            ruleOf(ctx)
          )
        : null;
    },
  ],

  [
    "exploreAlbum",
    (inputs, ctx) =>
      pickExploreAlbum(inputs.exploreBand as ExploreBand | null, albumCtx(ctx)),
  ],

  [
    "personalCandidates",
    (inputs) => collectCandidates(profileOf(inputs).similarGraph),
  ],

  [
    "personalBand",
    (inputs, ctx) =>
      withinTastePool(
        inputs.personalCandidates as PersonalCandidate[],
        ctx.config.genreOverlapThreshold
      ),
  ],

  [
    "personalPreference",
    (inputs, ctx) => {
      const band = inputs.personalBand as {
        pool: PersonalCandidate[];
        widened: boolean;
      };
      const rule = ruleOf(ctx);
      const { pool, relaxed } = preferredPool(band.pool, rule);
      return {
        pool,
        widened: band.widened,
        relaxed,
        rule,
      } satisfies PersonalBand;
    },
  ],

  [
    "personalAlbum",
    (inputs, ctx) =>
      pickPersonalAlbum(inputs.personalPreference as PersonalBand, {
        ...albumCtx(ctx),
        knownAlbums: new Set(profileOf(inputs).knownAlbums),
        genreOverlapThreshold: ctx.config.genreOverlapThreshold,
      }),
  ],

  [
    "artistSample",
    (inputs, ctx) =>
      sampleArtists(
        profileOf(inputs).artistTags,
        ctx.config.pickedArtistsCount,
        ctx.rng
      ),
  ],

  [
    "pickVector",
    (inputs) =>
      buildPickVector(
        profileOf(inputs),
        inputs.artistSample as DerivedProfile["artistTags"]
      ),
  ],

  [
    "tagDraw",
    (inputs, ctx) => drawTag(inputs.pickVector as SampledVector, ctx.rng),
  ],

  [
    "albumPool",
    (inputs, ctx) =>
      fetchTagAlbumPool(inputs.tagDraw as DrawnTag | null, ctx.config, ctx.rng),
  ],

  [
    "candidateWalk",
    (inputs, ctx) =>
      walkTagPool(inputs.albumPool as TagAlbumPool | null, {
        libraryPreference: ctx.config.libraryPreference,
        artistInLibrary: ctx.library.artistInLibrary,
        albumLibrary: ctx.library.albumLibrary,
        recentlyShown: ctx.excluded,
        budget: ctx.budget,
        priority: ctx.priority,
      }),
  ],

  [
    "sourceChain",
    async (_inputs, _ctx, runtime) => {
      for (const source of fallbackOrder("sourceChain")) {
        const built = (await runtime.resolve(source)) as BuiltAlbum | null;
        if (built) return built;
      }
      return null;
    },
  ],

  /**
   * The explore slots are allocated up front rather than re-rolled per pick, and every pick
   * adds its album to the exclusion set, so the carousel spans both bands instead of
   * repeating one pool. A slot is spent when its attempt is made: an explore slot that
   * yields nothing falls through to the adjacent band rather than making every later attempt
   * retry the same empty graph corner.
   */
  [
    "pickLoop",
    async (_inputs, ctx, runtime) => {
      const quota = await runtime.traced("exploreQuota");
      let exploresLeft = quota.value as number;
      const picks: TracedAlbum[] = [];
      const pickedAlbums = new Set<string>();
      const attemptLimit = ctx.count + PICK_ATTEMPT_SLACK;

      for (
        let attempt = 0;
        attempt < attemptLimit && picks.length < ctx.count;
        attempt += 1
      ) {
        ctx.exploring = exploresLeft > 0;
        if (ctx.exploring) exploresLeft -= 1;

        const { built, trace } = await tryAttempt(runtime);
        if (!built) continue;

        ctx.excluded.add(built.rememberKey);
        if (pickedAlbums.has(built.result.album.mbid)) continue;

        pickedAlbums.add(built.result.album.mbid);
        picks.push(traced(built, ctx, [...quota.trace, ...trace]));
      }

      return picks;
    },
  ],

  [
    "antiRepeat",
    async (inputs, ctx) => {
      const picks = inputs.pickLoop as TracedAlbum[];
      if (picks.length === 0) return picks;

      const shown = picks.map((pick) => pick.rememberKey);
      await updateExplorationHistory(ctx.userId, {
        albums: [
          ...shown,
          ...ctx.recentAlbums.filter((mbid) => !shown.includes(mbid)),
        ].slice(0, RECENT_SHOWN_LIMIT),
      });

      return picks;
    },
  ],
]);
