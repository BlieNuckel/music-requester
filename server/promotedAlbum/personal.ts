import { fetchReleaseGroupsForArtist } from "../api/musicbrainz/releaseGroups";
import type { MbPriority } from "../api/musicbrainz/queue";
import type { MusicBrainzReleaseGroup } from "../api/musicbrainz/types";
import type { AlbumLibraryInfo } from "../../shared/albumLibrary";
import type {
  SimilarGraphSeed,
  SimilarGraphCandidate,
} from "../db/entity/UserProfile";
import { isRecommendableRelease } from "../services/discover/typeFilter";
import { isPlaceholderArtist } from "../utils/artistFilter";
import { weightedRandomPick, shuffle, type Rng } from "../utils/random";
import { normalizeAlbumKey } from "../utils/albumKey";
import { isNearGenre, jaccard } from "./genreBand";
import { preferredOrRelaxed } from "./preference";
import type { PreferenceRule } from "./preference";
import type { BuiltAlbum, PersonalResult, ResolutionBudget } from "./types";

/** What the album walk needs, once the band has been settled. */
export type PersonalAlbumContext = {
  /** Normalized `artist::album` keys the user already plays; those are not discoveries. */
  knownAlbums: Set<string>;
  genreOverlapThreshold: number;
  recentlyShown: Set<string>;
  artistInLibrary: (artistMbid: string) => boolean;
  albumLibrary: (rgMbid: string) => AlbumLibraryInfo | null;
  /** Shared with the other sources, so one carousel build has a single MusicBrainz allowance. */
  budget?: ResolutionBudget;
  rng?: Rng;
  /** Warmer builds take the background lane so nobody's page load queues behind them. */
  priority?: MbPriority;
};

/** One neighbour of the user's listening, with what the walk and the trace both need. */
export type PersonalCandidate = {
  candidate: SimilarGraphCandidate;
  genres: Set<string>;
  seedArtist: string;
  seedGenres: Set<string>;
  overlap: number;
  weight: number;
  /** The single largest seed contribution, which decides who gets credited as the seed. */
  topSeedWeight: number;
};

/** The neighbours this pick draws from, and what narrowing them took. */
export type PersonalBand = {
  pool: PersonalCandidate[];
  widened: boolean;
  relaxed: boolean;
  rule: PreferenceRule;
};

/**
 * Candidate artists one pick may try before giving up and letting the tag path run. Kept
 * small on purpose: every attempt spends the build's shared MusicBrainz budget, and a source
 * that burns it all leaves the fallback nothing to spend, which is an empty carousel rather
 * than a worse one.
 */
const ARTIST_ATTEMPTS = 3;

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
  const near = candidates.filter((c) =>
    isNearGenre(c.genres, c.overlap, threshold)
  );
  return near.length > 0
    ? { pool: near, widened: false }
    : { pool: candidates, widened: true };
}

/**
 * The neighbours this band is actually about: the ones on the preferred side of the library
 * line. Ordering the walk by preference — which this replaces — cannot help when the draw
 * itself never surfaced an unowned neighbour, and for a user who owns most of their graph
 * every draw comes back owned, so "adjacent to your taste and you don't have it" quietly
 * stops happening. Filtering before the draw is what makes the library line load-bearing
 * rather than a tiebreak among whatever three artists the weights happened to pick.
 *
 * Falls back to the whole pool when the preferred side is empty, and the trace records it —
 * a recommendation the user already owns beats no recommendation.
 */
export function preferredPool(
  pool: PersonalCandidate[],
  rule: PreferenceRule
): { pool: PersonalCandidate[]; relaxed: boolean } {
  const { items, relaxed } = preferredOrRelaxed(
    pool,
    (c) => c.candidate.artistMbid,
    rule
  );
  return { pool: items, relaxed };
}

/**
 * A candidate artist's albums worth recommending: {@link isRecommendableRelease}, and not one
 * this user already listens to.
 */
export function eligibleAlbums(
  releaseGroups: MusicBrainzReleaseGroup[],
  artistName: string,
  knownAlbums: Set<string>
): MusicBrainzReleaseGroup[] {
  return releaseGroups.filter(
    (rg) =>
      isRecommendableRelease(rg) &&
      !knownAlbums.has(normalizeAlbumKey(artistName, rg.title))
  );
}

async function pickAlbumFor(
  chosen: PersonalCandidate,
  ctx: PersonalAlbumContext,
  rng: Rng
): Promise<MusicBrainzReleaseGroup | null> {
  const releaseGroups = await fetchReleaseGroupsForArtist(
    chosen.candidate.artistMbid,
    ctx.priority ?? "interactive"
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

function assembleResult(
  ctx: PersonalAlbumContext,
  chosen: PersonalCandidate,
  album: MusicBrainzReleaseGroup
): BuiltAlbum {
  const sharedGenres = [...chosen.genres].filter((g) =>
    chosen.seedGenres.has(g)
  );
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
 * budget. Returns null when no drawn candidate yields an eligible album, and the source chain
 * falls through to the tag path — which is the only thing that works for a user whose graph
 * has not been built yet.
 */
export async function pickPersonalAlbum(
  band: PersonalBand | null,
  ctx: PersonalAlbumContext
): Promise<BuiltAlbum | null> {
  if (!band || band.pool.length === 0) return null;
  const rng = ctx.rng ?? Math.random;

  const drawn = weightedRandomPick(
    band.pool,
    (c) => c.weight,
    ARTIST_ATTEMPTS,
    rng
  );

  for (const chosen of drawn) {
    if (ctx.budget && ctx.budget.remaining <= 0) break;
    if (ctx.budget) ctx.budget.remaining -= 1;

    const album = await pickAlbumFor(chosen, ctx, rng);
    if (album) return assembleResult(ctx, chosen, album);
  }

  return null;
}
