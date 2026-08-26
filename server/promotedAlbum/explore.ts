import { getSimilarArtists } from "../api/listenbrainz/similarArtists";
import { getArtistMbidByName } from "../api/musicbrainz/artists";
import { fetchReleaseGroupsForArtist } from "../api/musicbrainz/releaseGroups";
import { isRecommendableRelease } from "../services/discover/typeFilter";
import type { MbPriority } from "../api/musicbrainz/queue";
import { getArtistTopTags } from "../api/lastfm/artists";
import type { MusicBrainzReleaseGroup } from "../api/musicbrainz/types";
import type { PromotedAlbumConfig } from "../config";
import type { AlbumLibraryInfo } from "../../shared/albumLibrary";
import type {
  SimilarGraphSeed,
  SimilarGraphCandidate,
} from "../db/entity/UserProfile";
import { weightedRandomPick, shuffle, type Rng } from "../utils/random";
import { isPlaceholderArtist } from "../utils/artistFilter";
import { isDistantGenre, jaccard } from "./genreBand";
import { preferredOrRelaxed } from "./preference";
import type { PreferenceRule } from "./preference";
import type {
  BuiltAlbum,
  ResolutionBudget,
  ExploreResult,
  ExploreTrace,
  TraceSelectionReason,
  TraceSimilarArtist,
} from "./types";
import { classifyTag, foldTag } from "../genres/classify";

type GraphSeedArtist = { name: string; viewCount: number };

/** What the album walk needs, once the band has been settled. */
export type ExploreAlbumContext = {
  recentlyShown: Set<string>;
  artistInLibrary: (artistMbid: string) => boolean;
  albumLibrary: (rgMbid: string) => AlbumLibraryInfo | null;
  /** Shared with the other sources, so one carousel build has a single MusicBrainz allowance. */
  budget?: ResolutionBudget;
  rng?: Rng;
  /** Warmer builds take the background lane so nobody's page load queues behind them. */
  priority?: MbPriority;
};

type EvaluatedCandidate = {
  candidate: SimilarGraphCandidate;
  genres: Set<string>;
  overlap: number;
  isDifferentGenre: boolean;
};

/** One seed's neighbours, split by the genre line and narrowed to the preferred side. */
export type ExploreBand = {
  seedArtist: string;
  seedGenres: Set<string>;
  /** Every neighbour of the seed, whichever band it fell in — the trace lists them all. */
  evaluated: EvaluatedCandidate[];
  /** The ones worth walking, most similar first. */
  ranked: EvaluatedCandidate[];
};

const SEED_GENRE_LIMIT = 8;

async function safeTopTags(
  name: string
): Promise<{ name: string; count: number }[]> {
  try {
    return await getArtistTopTags(name);
  } catch {
    return [];
  }
}

/**
 * The genres two artists are compared on. Canonicalized, and non-genres left out entirely:
 * genre overlap is measured on exact strings, so before this a seed tagged `DnB` and a
 * candidate tagged `Drum and bass` scored zero overlap and the explore/personal split was
 * being decided by which spelling each artist happened to attract.
 */
function buildGenreSet(
  tags: { name: string; count: number }[],
  genericTags: Set<string>,
  limit: number
): Set<string> {
  const set = new Set<string>();
  for (const t of tags) {
    const classified = classifyTag(t.name);
    if (classified.class !== "genre") continue;
    const name = foldTag(classified.canonical);
    if (genericTags.has(name)) continue;
    set.add(name);
    if (set.size >= limit) break;
  }
  return set;
}

/**
 * Resolve one seed artist into a graph entry: its MusicBrainz MBID, genre set,
 * and the genre-tagged similar artists explore can branch to. Returns null when
 * the seed can't be resolved, has no similar artists, or has no non-generic
 * genres — such seeds are simply omitted from the graph.
 */
async function buildSeed(
  artist: GraphSeedArtist,
  config: PromotedAlbumConfig,
  genericTags: Set<string>
): Promise<SimilarGraphSeed | null> {
  const seedMbid = await getArtistMbidByName(artist.name, "background");
  if (!seedMbid) return null;

  const similar = await getSimilarArtists(seedMbid);
  if (similar.length === 0) return null;

  const seedGenres = buildGenreSet(
    await safeTopTags(artist.name),
    genericTags,
    SEED_GENRE_LIMIT
  );
  if (seedGenres.size === 0) return null;

  const candidates = similar
    .filter((c) => !isPlaceholderArtist(c.name, c.artist_mbid))
    .slice(0, config.exploreCandidateCount);
  const tagSets = await Promise.all(candidates.map((c) => safeTopTags(c.name)));

  return {
    seedArtist: artist.name,
    seedMbid,
    seedGenres: [...seedGenres],
    viewCount: artist.viewCount,
    candidates: candidates.map((c, i) => ({
      name: c.name,
      artistMbid: c.artist_mbid,
      score: c.score,
      genres: [...buildGenreSet(tagSets[i], genericTags, SEED_GENRE_LIMIT)],
    })),
  };
}

/**
 * Build the explore similar-artist graph from a user's seed artists. This is the
 * expensive fan-out (MusicBrainz + ListenBrainz + Last.fm) that used to run on
 * every explore request; it now runs once at profile-regeneration time. Seeds are
 * resolved sequentially so the per-seed network load stays identical to the old
 * per-request path rather than firing every seed's fan-out at once.
 */
export async function buildSimilarGraph(
  plexArtists: GraphSeedArtist[],
  config: PromotedAlbumConfig
): Promise<SimilarGraphSeed[]> {
  const genericTags = new Set(config.genericTags.map((t) => t.toLowerCase()));
  const seeds: SimilarGraphSeed[] = [];
  for (const artist of plexArtists) {
    const seed = await buildSeed(artist, config, genericTags);
    if (seed) seeds.push(seed);
  }
  return seeds;
}

function evaluateSeed(
  seed: SimilarGraphSeed,
  seedGenres: Set<string>,
  threshold: number
): EvaluatedCandidate[] {
  return seed.candidates
    .filter((c) => !isPlaceholderArtist(c.name, c.artistMbid))
    .map((candidate) => {
      const genres = new Set(candidate.genres);
      const overlap = jaccard(seedGenres, genres);
      return {
        candidate,
        genres,
        overlap,
        isDifferentGenre: isDistantGenre(genres, overlap, threshold),
      };
    });
}

/**
 * One of the user's own artists to jump away from, weighted by how much they play it.
 * Null when the graph is empty or the drawn seed carries no genres — there is nothing to
 * measure distance from.
 */
export function drawExploreSeed(
  similarGraph: SimilarGraphSeed[],
  rng: Rng
): SimilarGraphSeed | null {
  if (similarGraph.length === 0) return null;
  const [seed] = weightedRandomPick(similarGraph, (s) => s.viewCount, 1, rng);
  if (!seed || seed.seedGenres.length === 0) return null;
  return seed;
}

/**
 * The seed's neighbours that are far enough away to count as a jump, on the preferred side
 * of the library line, most similar first.
 *
 * The preference used to be read here only to label the trace, while the personal source
 * filtered on it — so asking for records you do not own was honoured by one source and
 * ignored by the other. Same rule now, both sides.
 */
export function rankDistantNeighbours(
  seed: SimilarGraphSeed,
  threshold: number,
  rule: PreferenceRule
): ExploreBand {
  const seedGenres = new Set(seed.seedGenres);
  const evaluated = evaluateSeed(seed, seedGenres, threshold);
  const distant = evaluated.filter((e) => e.isDifferentGenre);
  const { items } = preferredOrRelaxed(
    distant,
    (e) => e.candidate.artistMbid,
    rule
  );

  return {
    seedArtist: seed.seedArtist,
    seedGenres,
    evaluated,
    ranked: [...items].sort((a, b) => b.candidate.score - a.candidate.score),
  };
}

async function pickAlbumFromArtist(
  artistMbid: string,
  recentlyShown: Set<string>,
  rng: Rng,
  priority: MbPriority
): Promise<MusicBrainzReleaseGroup | null> {
  const releaseGroups = await fetchReleaseGroupsForArtist(artistMbid, priority);
  const albums = releaseGroups.filter(isRecommendableRelease);
  if (albums.length === 0) return null;

  const shuffled = shuffle(albums, rng);
  const fresh = shuffled.filter((rg) => !recentlyShown.has(rg.id));
  const pool = fresh.length > 0 ? fresh : shuffled;
  return pool[0] ?? null;
}

function buildExploreTrace(
  band: ExploreBand,
  chosen: EvaluatedCandidate,
  newGenres: string[],
  selectionReason: TraceSelectionReason
): ExploreTrace {
  const candidates: TraceSimilarArtist[] = band.evaluated.map((e) => ({
    name: e.candidate.name,
    score: e.candidate.score,
    genres: [...e.genres],
    genreOverlap: e.overlap,
    isDifferentGenre: e.isDifferentGenre,
    chosen: e.candidate.artistMbid === chosen.candidate.artistMbid,
  }));

  return {
    kind: "explore",
    seedArtist: band.seedArtist,
    seedGenres: [...band.seedGenres],
    candidates,
    chosenArtist: chosen.candidate.name,
    chosenGenres: [...chosen.genres],
    newGenres,
    selectionReason,
  };
}

function assembleResult(
  ctx: ExploreAlbumContext,
  band: ExploreBand,
  chosen: EvaluatedCandidate,
  album: MusicBrainzReleaseGroup
): BuiltAlbum {
  const newGenres = [...chosen.genres].filter((g) => !band.seedGenres.has(g));
  const selectionReason: TraceSelectionReason = ctx.artistInLibrary(
    chosen.candidate.artistMbid
  )
    ? "fallback_in_library"
    : "preferred_non_library";

  const library = ctx.albumLibrary(album.id);

  const result: ExploreResult = {
    mode: "explore",
    album: {
      name: album.title,
      mbid: album.id,
      artistName: chosen.candidate.name,
      artistMbid: chosen.candidate.artistMbid,
      coverUrl: `https://coverartarchive.org/release-group/${album.id}/front-500`,
      year: (album["first-release-date"] || "").slice(0, 4),
    },
    seedArtist: band.seedArtist,
    newGenres,
    inLibrary: library !== null,
    library,
    trace: buildExploreTrace(band, chosen, newGenres, selectionReason),
  };

  return { result, rememberKey: album.id };
}

/**
 * "Similar vibe, different genre": walk the genre-distant neighbours until one has a record
 * worth recommending. No similarity or genre network calls happen here — those are baked
 * into the graph at regeneration time; the only per-request fetch is the album pick.
 *
 * Each candidate costs one paced discography lookup, so the walk spends the build's shared
 * budget rather than trying every distant artist the seed offers. Returns null when none of
 * them yields an album, and the source chain falls through to the next source.
 */
export async function pickExploreAlbum(
  band: ExploreBand | null,
  ctx: ExploreAlbumContext
): Promise<BuiltAlbum | null> {
  if (!band) return null;
  const rng = ctx.rng ?? Math.random;

  for (const chosen of band.ranked) {
    if (ctx.budget && ctx.budget.remaining <= 0) break;
    if (ctx.budget) ctx.budget.remaining -= 1;

    const album = await pickAlbumFromArtist(
      chosen.candidate.artistMbid,
      ctx.recentlyShown,
      rng,
      ctx.priority ?? "interactive"
    );
    if (album) return assembleResult(ctx, band, chosen, album);
  }

  return null;
}
