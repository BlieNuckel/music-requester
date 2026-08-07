import { getSimilarArtists } from "../api/listenbrainz/similarArtists";
import { getArtistMbidByName } from "../api/musicbrainz/artists";
import { fetchReleaseGroupsForArtist } from "../api/musicbrainz/releaseGroups";
import { getArtistTopTags } from "../api/lastfm/artists";
import type { MusicBrainzReleaseGroup } from "../api/musicbrainz/types";
import type { PromotedAlbumConfig } from "../config";
import type {
  SimilarGraphSeed,
  SimilarGraphCandidate,
} from "../db/entity/UserProfile";
import { weightedRandomPick, shuffle } from "../utils/random";
import { isPlaceholderArtist } from "../utils/artistFilter";
import type {
  BuiltAlbum,
  ExploreResult,
  ExploreTrace,
  TraceSelectionReason,
  TraceSimilarArtist,
} from "./types";

type GraphSeedArtist = { name: string; viewCount: number };

type ExploreContext = {
  similarGraph: SimilarGraphSeed[];
  config: PromotedAlbumConfig;
  recentlyShown: Set<string>;
  artistInLibrary: (artistMbid: string) => boolean;
  albumInLibrary: (rgMbid: string) => boolean;
};

type EvaluatedCandidate = {
  candidate: SimilarGraphCandidate;
  genres: Set<string>;
  overlap: number;
  isDifferentGenre: boolean;
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

function buildGenreSet(
  tags: { name: string; count: number }[],
  genericTags: Set<string>,
  limit: number
): Set<string> {
  const set = new Set<string>();
  for (const t of tags) {
    const name = t.name.toLowerCase();
    if (genericTags.has(name)) continue;
    set.add(name);
    if (set.size >= limit) break;
  }
  return set;
}

/** Jaccard similarity of two genre sets (0 = disjoint, 1 = identical). */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
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
        isDifferentGenre: genres.size > 0 && overlap <= threshold,
      };
    });
}

async function pickAlbumFromArtist(
  artistMbid: string,
  recentlyShown: Set<string>
): Promise<MusicBrainzReleaseGroup | null> {
  const releaseGroups = await fetchReleaseGroupsForArtist(artistMbid);
  const albums = releaseGroups.filter(
    (rg) => rg["primary-type"] === "Album" && rg["first-release-date"] && rg.id
  );
  if (albums.length === 0) return null;

  const shuffled = shuffle(albums);
  const fresh = shuffled.filter((rg) => !recentlyShown.has(rg.id));
  const pool = fresh.length > 0 ? fresh : shuffled;
  return pool[0] ?? null;
}

function buildExploreTrace(
  seedArtist: string,
  seedGenres: Set<string>,
  evaluated: EvaluatedCandidate[],
  chosen: EvaluatedCandidate,
  newGenres: string[],
  selectionReason: TraceSelectionReason
): ExploreTrace {
  const candidates: TraceSimilarArtist[] = evaluated.map((e) => ({
    name: e.candidate.name,
    score: e.candidate.score,
    genres: [...e.genres],
    genreOverlap: e.overlap,
    isDifferentGenre: e.isDifferentGenre,
    chosen: e.candidate.artistMbid === chosen.candidate.artistMbid,
  }));

  return {
    kind: "explore",
    seedArtist,
    seedGenres: [...seedGenres],
    candidates,
    chosenArtist: chosen.candidate.name,
    chosenGenres: [...chosen.genres],
    newGenres,
    selectionReason,
  };
}

function assembleResult(
  ctx: ExploreContext,
  seedArtist: string,
  seedGenres: Set<string>,
  evaluated: EvaluatedCandidate[],
  chosen: EvaluatedCandidate,
  album: MusicBrainzReleaseGroup
): BuiltAlbum {
  const newGenres = [...chosen.genres].filter((g) => !seedGenres.has(g));
  const selectionReason: TraceSelectionReason = ctx.artistInLibrary(
    chosen.candidate.artistMbid
  )
    ? "fallback_in_library"
    : "preferred_non_library";

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
    seedArtist,
    newGenres,
    inLibrary: ctx.albumInLibrary(album.id),
    trace: buildExploreTrace(
      seedArtist,
      seedGenres,
      evaluated,
      chosen,
      newGenres,
      selectionReason
    ),
  };

  return { result, rememberKey: album.id };
}

/**
 * "Similar vibe, different genre": pick a seed from the persisted similar-artist
 * graph (weighted by play count), keep only similar artists in a genre the seed
 * doesn't share, and surface an album by one of them. No similarity/genre network
 * calls happen here — those are baked into the graph at regeneration time; the
 * only per-request fetch is the album pick. Returns null when the graph is empty
 * or no genre-distant candidate yields an album, so the caller falls back to
 * within-taste.
 */
export async function buildExploreResult(
  ctx: ExploreContext
): Promise<BuiltAlbum | null> {
  const { similarGraph, config, recentlyShown } = ctx;
  if (similarGraph.length === 0) return null;

  const [seed] = weightedRandomPick(similarGraph, (s) => s.viewCount, 1);
  if (!seed) return null;

  const seedGenres = new Set(seed.seedGenres);
  if (seedGenres.size === 0) return null;

  const evaluated = evaluateSeed(
    seed,
    seedGenres,
    config.genreOverlapThreshold
  );

  const ranked = evaluated
    .filter((e) => e.isDifferentGenre)
    .sort((a, b) => b.candidate.score - a.candidate.score);

  for (const chosen of ranked) {
    const album = await pickAlbumFromArtist(
      chosen.candidate.artistMbid,
      recentlyShown
    );
    if (album) {
      return assembleResult(
        ctx,
        seed.seedArtist,
        seedGenres,
        evaluated,
        chosen,
        album
      );
    }
  }

  return null;
}
