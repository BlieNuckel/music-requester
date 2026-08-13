import { fetchReleaseGroupsForArtist } from "../api/musicbrainz/releaseGroups";
import type { MusicBrainzReleaseGroup } from "../api/musicbrainz/types";
import type { PromotedAlbumConfig } from "../config";
import type { AlbumLibraryInfo } from "../../shared/albumLibrary";
import type {
  SimilarGraphSeed,
  SimilarGraphCandidate,
} from "../db/entity/UserProfile";
import { isAllowedReleaseType } from "../services/discover/typeFilter";
import { isPlaceholderArtist } from "../utils/artistFilter";
import { weightedRandomPick, shuffle, type Rng } from "../utils/random";
import { jaccard } from "./explore";
import { normalizeAlbumKey } from "./knownAlbums";
import { preferenceRule, orderByPreference } from "./preference";
import type { PreferenceRule } from "./preference";
import type {
  BuiltAlbum,
  PersonalResult,
  PersonalTrace,
  ResolutionBudget,
  TraceSimilarArtist,
} from "./types";

export type PersonalContext = {
  similarGraph: SimilarGraphSeed[];
  /** Normalized `artist::album` keys the user already plays; those are not discoveries. */
  knownAlbums: Set<string>;
  config: PromotedAlbumConfig;
  recentlyShown: Set<string>;
  artistInLibrary: (artistMbid: string) => boolean;
  albumLibrary: (rgMbid: string) => AlbumLibraryInfo | null;
  /** Shared with the other sources, so one carousel build has a single MusicBrainz allowance. */
  budget?: ResolutionBudget;
  rng?: Rng;
};

/** One neighbour of the user's listening, with what the walk and the trace both need. */
type PersonalCandidate = {
  candidate: SimilarGraphCandidate;
  genres: Set<string>;
  seedArtist: string;
  seedGenres: Set<string>;
  overlap: number;
  weight: number;
  /** The single largest seed contribution, which decides who gets credited as the seed. */
  topSeedWeight: number;
};

/**
 * Candidate artists one pick may try before giving up and letting the tag path run. Kept
 * small on purpose: every attempt spends the build's shared MusicBrainz budget, and a source
 * that burns it all leaves the fallback nothing to spend, which is an empty carousel rather
 * than a worse one.
 */
const ARTIST_ATTEMPTS = 3;

/** Cap on neighbours listed in the trace — the pool can be a hundred-odd artists. */
const TRACE_CANDIDATE_LIMIT = 12;

/**
 * Every neighbour in the user's graph, weighted by how much they play the seed it came from
 * times how strongly ListenBrainz ties the two. An artist reachable from several seeds
 * accumulates all of them — sitting next to two artists you play is stronger evidence than
 * sitting next to one — and is credited to whichever seed contributed most.
 */
export function collectCandidates(
  graph: SimilarGraphSeed[]
): PersonalCandidate[] {
  const byArtist = new Map<string, PersonalCandidate>();

  for (const seed of graph) {
    const seedGenres = new Set(seed.seedGenres);
    for (const candidate of seed.candidates) {
      if (isPlaceholderArtist(candidate.name, candidate.artistMbid)) continue;

      const genres = new Set(candidate.genres);
      const weight = Math.max(0, seed.viewCount) * Math.max(0, candidate.score);
      const existing = byArtist.get(candidate.artistMbid);
      if (!existing) {
        byArtist.set(candidate.artistMbid, {
          candidate,
          genres,
          seedArtist: seed.seedArtist,
          seedGenres,
          overlap: jaccard(seedGenres, genres),
          weight,
          topSeedWeight: weight,
        });
        continue;
      }

      existing.weight += weight;
      if (weight > existing.topSeedWeight) {
        existing.topSeedWeight = weight;
        existing.seedArtist = seed.seedArtist;
        existing.seedGenres = seedGenres;
        existing.overlap = jaccard(seedGenres, genres);
      }
    }
  }

  return [...byArtist.values()];
}

/**
 * The neighbours close enough to still be this user's taste — the same genre-overlap line
 * explore uses, read from the other side, so the two modes partition the graph rather than
 * compete for it. When nothing is close enough the whole graph is used instead of dropping
 * to global tag popularity, and the trace records that the pool widened.
 */
export function withinTastePool(
  candidates: PersonalCandidate[],
  threshold: number
): { pool: PersonalCandidate[]; widened: boolean } {
  const near = candidates.filter(
    (c) => c.genres.size > 0 && c.overlap > threshold
  );
  return near.length > 0
    ? { pool: near, widened: false }
    : { pool: candidates, widened: true };
}

/**
 * A candidate artist's albums worth recommending: a release type that is an album rather than
 * a live/remix/compilation package, dated, and not one this user already listens to. The type
 * filter is wider than explore's `primary-type === "Album"` on purpose — an EP by an artist
 * adjacent to your listening is a fine recommendation, whereas explore is about genre reach.
 */
export function eligibleAlbums(
  releaseGroups: MusicBrainzReleaseGroup[],
  artistName: string,
  knownAlbums: Set<string>
): MusicBrainzReleaseGroup[] {
  return releaseGroups.filter((rg) => {
    if (!rg.id || !rg["first-release-date"]) return false;
    if (
      !isAllowedReleaseType(
        rg["primary-type"] ?? null,
        rg["secondary-types"] ?? null
      )
    ) {
      return false;
    }
    return !knownAlbums.has(normalizeAlbumKey(artistName, rg.title));
  });
}

async function pickAlbumFor(
  chosen: PersonalCandidate,
  ctx: PersonalContext,
  rng: Rng
): Promise<MusicBrainzReleaseGroup | null> {
  const releaseGroups = await fetchReleaseGroupsForArtist(
    chosen.candidate.artistMbid
  );
  const eligible = eligibleAlbums(
    releaseGroups,
    chosen.candidate.name,
    ctx.knownAlbums
  );
  if (eligible.length === 0) return null;

  const shuffled = shuffle(eligible, rng);
  const fresh = shuffled.filter((rg) => !ctx.recentlyShown.has(rg.id));
  return fresh[0] ?? shuffled[0] ?? null;
}

/**
 * The neighbours the trace shows: the heaviest of the pool, always including the one the
 * album came from. Listing the whole pool would put a hundred artists on every card.
 */
function traceCandidates(
  pool: PersonalCandidate[],
  chosen: PersonalCandidate,
  threshold: number
): TraceSimilarArtist[] {
  const ranked = [...pool].sort((a, b) => b.weight - a.weight);
  const shown = ranked.slice(0, TRACE_CANDIDATE_LIMIT);
  if (!shown.includes(chosen)) shown.push(chosen);

  return shown.map((c) => ({
    name: c.candidate.name,
    score: c.candidate.score,
    genres: [...c.genres],
    genreOverlap: c.overlap,
    isDifferentGenre: c.genres.size > 0 && c.overlap <= threshold,
    chosen: c.candidate.artistMbid === chosen.candidate.artistMbid,
  }));
}

function assembleResult(
  ctx: PersonalContext,
  pool: PersonalCandidate[],
  chosen: PersonalCandidate,
  album: MusicBrainzReleaseGroup,
  widened: boolean,
  rule: PreferenceRule
): BuiltAlbum {
  const sharedGenres = [...chosen.genres].filter((g) =>
    chosen.seedGenres.has(g)
  );
  const selectionReason = rule.isPreferred(chosen.candidate.artistMbid)
    ? rule.preferredReason
    : rule.fallbackReason;

  const trace: PersonalTrace = {
    kind: "personal",
    seedArtist: chosen.seedArtist,
    seedGenres: [...chosen.seedGenres],
    candidates: traceCandidates(pool, chosen, ctx.config.genreOverlapThreshold),
    chosenArtist: chosen.candidate.name,
    chosenGenres: [...chosen.genres],
    sharedGenres,
    widened,
    selectionReason,
  };

  const library = ctx.albumLibrary(album.id);

  const result: PersonalResult = {
    mode: "personal",
    album: {
      name: album.title,
      mbid: album.id,
      artistName: chosen.candidate.name,
      artistMbid: chosen.candidate.artistMbid,
      coverUrl: `https://coverartarchive.org/release-group/${album.id}/front-500`,
      year: (album["first-release-date"] || "").slice(0, 4),
    },
    seedArtist: chosen.seedArtist,
    sharedGenres,
    inLibrary: library !== null,
    library,
    trace,
  };

  return { result, rememberKey: album.id };
}

/**
 * A recommendation drawn from what this user actually plays: an artist adjacent to their own
 * listening, and an album by that artist. Nothing here consults a genre's global album chart,
 * which is what the tag path does and why it converges on the canonical famous records of a
 * genre — the ones a fan of that genre already owns.
 *
 * Costs one paced discography lookup per candidate artist tried, against the build's shared
 * budget. Returns null when the graph is empty or no candidate yields an eligible album, and
 * the caller falls back to the tag path — which is the only thing that works for a user whose
 * graph hasn't been built yet.
 */
export async function buildPersonalResult(
  ctx: PersonalContext
): Promise<BuiltAlbum | null> {
  const rng = ctx.rng ?? Math.random;
  if (ctx.similarGraph.length === 0) return null;

  const candidates = collectCandidates(ctx.similarGraph);
  if (candidates.length === 0) return null;

  const { pool, widened } = withinTastePool(
    candidates,
    ctx.config.genreOverlapThreshold
  );
  const drawn = weightedRandomPick(pool, (c) => c.weight, ARTIST_ATTEMPTS, rng);
  const rule = preferenceRule(
    ctx.config.libraryPreference,
    ctx.artistInLibrary
  );

  for (const chosen of orderByPreference(
    drawn,
    (c) => c.candidate.artistMbid,
    rule
  )) {
    if (ctx.budget && ctx.budget.remaining <= 0) break;
    if (ctx.budget) ctx.budget.remaining -= 1;

    const album = await pickAlbumFor(chosen, ctx, rng);
    if (album) {
      return assembleResult(ctx, pool, chosen, album, widened, rule);
    }
  }

  return null;
}
