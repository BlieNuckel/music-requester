import { getTopAlbumsByTag } from "../api/lastfm/albums";
import { resolveReleaseGroupInfo } from "../api/musicbrainz/releaseGroups";
import type { MbPriority } from "../api/musicbrainz/queue";
import type { ReleaseGroupInfo } from "../api/musicbrainz/types";
import type { LibraryPreference, PromotedAlbumConfig } from "../config";
import type { AlbumLibraryInfo } from "../../shared/albumLibrary";
import type { DerivedProfile } from "../db/entity/UserProfile";
import { isAllowedReleaseType } from "../services/discover/typeFilter";
import { createLogger } from "../logger";
import { isPlaceholderArtist } from "../utils/artistFilter";
import { weightedRandomPick, shuffle, type Rng } from "../utils/random";
import { preferenceRule, orderByPreference } from "./preference";
import type { PreferenceRule } from "./preference";
import {
  buildGenreVector,
  artistGenreUnits,
  type GenreUnit,
} from "./profileService";
import type { BuiltAlbum, ResolutionBudget, WithinTasteResult } from "./types";

export type WeightedTag = { name: string; weight: number };

/** The artists this one pick speaks for, and the genre vector they add up to. */
export type SampledVector = {
  sampled: DerivedProfile["artistTags"];
  vector: DerivedProfile["genreVector"];
};

/** That vector, with the one genre drawn from it. */
export type DrawnTag = SampledVector & { tag: WeightedTag };

/** One Last.fm tag-chart album, before it has been resolved to a release group. */
export type CandidateAlbum = {
  mbid: string;
  artistMbid: string;
  name: string;
  artistName: string;
};

/** How much of the genre's chart this pick saw, which is what the pool amounts to. */
export type TagPoolShape = {
  page1Count: number;
  deepPage: number;
  deepPageCount: number;
  totalAfterDedup: number;
};

/** The genre's chart, shuffled, and how much of it was drawn on. */
export type TagAlbumPool = DrawnTag & {
  albums: CandidateAlbum[];
  poolInfo: TagPoolShape;
};

/** What the walk needs to resolve candidates and settle on one. */
export type TagWalkContext = {
  libraryPreference: LibraryPreference;
  artistInLibrary: (mbid: string) => boolean;
  albumLibrary: (mbid: string) => AlbumLibraryInfo | null;
  recentlyShown: Set<string>;
  budget: ResolutionBudget;
  priority: MbPriority;
};

type GetRgInfo = (mbid: string) => Promise<ReleaseGroupInfo | null>;

type SelectionWalk = PreferenceRule & {
  candidates: CandidateAlbum[];
  getRgInfo: GetRgInfo;
  recentlyShown: Set<string>;
  budget: ResolutionBudget;
};

type AlbumSelection = {
  album: CandidateAlbum;
  rgMbid: string;
  year: string;
};

const log = createLogger("promoted-album");

/** Whether a set of units can put anything in the vector at all. */
const carriesGenres = (units: GenreUnit[]): boolean =>
  units.some((unit) => unit.tags.length > 0);

/**
 * The artists one recommendation is drawn from, re-sampled per pick and weighted by play
 * weight. The sample used to happen at regeneration time, which froze one draw of three
 * artists into the profile and let it shape every recommendation for the whole 24h TTL.
 * Drawing here instead means a day's carousel spans the user's whole top-artist set, and
 * two picks in the same batch can come from different corners of it.
 */
export function sampleArtists(
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
 *
 * The test is whether the albums carry genres, not whether they exist. An album resolving to
 * no genre is still stored — it carries what else we know about it — and counting those rows
 * as a usable sample would suppress the artist fallback and hand back an empty vector.
 */
function sampledGenreUnits(
  profile: DerivedProfile,
  sampled: DerivedProfile["artistTags"]
): GenreUnit[] {
  const names = new Set(sampled.map((a) => a.name));
  const albums = profile.albumTags.filter((a) => names.has(a.artistName));
  return carriesGenres(albums) ? albums : artistGenreUnits(sampled);
}

/**
 * This pick's genre vector, falling back to the profile's own when the sample carries no
 * genres at all — which is the same vector, built from whatever sample that profile froze.
 */
export function buildPickVector(
  profile: DerivedProfile,
  sampled: DerivedProfile["artistTags"]
): SampledVector {
  const sampledVector = buildGenreVector(sampledGenreUnits(profile, sampled));
  return {
    sampled,
    vector: sampledVector.length > 0 ? sampledVector : profile.genreVector,
  };
}

/** One genre, drawn by how much of the sampled listening it covers. */
export function drawTag(input: SampledVector, rng: Rng): DrawnTag | null {
  const weightedTags: WeightedTag[] = input.vector.map((g) => ({
    name: g.tag,
    weight: g.weight,
  }));
  if (weightedTags.length === 0) return null;

  const [tag] = weightedRandomPick(weightedTags, (t) => t.weight, 1, rng);
  return tag ? { ...input, tag } : null;
}

/**
 * The genre's album chart: page one, plus one page from deeper in it so the pool is not the
 * same twenty famous records every time. Shuffled here because the order the chart arrives
 * in is popularity, and walking it in that order recommends the same album to everyone.
 */
export async function fetchTagAlbumPool(
  drawn: DrawnTag | null,
  config: PromotedAlbumConfig,
  rng: Rng
): Promise<TagAlbumPool | null> {
  if (!drawn) return null;

  const range = config.deepPageMax - config.deepPageMin + 1;
  const deepPage = String(Math.floor(rng() * range) + config.deepPageMin);
  const [page1, pageDeep] = await Promise.all([
    getTopAlbumsByTag(drawn.tag.name, "1"),
    getTopAlbumsByTag(drawn.tag.name, deepPage),
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

  return {
    ...drawn,
    albums: shuffle(allAlbums, rng),
    poolInfo: {
      page1Count: page1.albums.length,
      deepPage: Number(deepPage),
      deepPageCount: pageDeep.albums.length,
      totalAfterDedup: allAlbums.length,
    },
  };
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
    };
  }

  return null;
}

/**
 * Anti-repeat runs inside the walk rather than over the raw pool because the memory is keyed
 * on release-group MBIDs, and a Last.fm chart entry only has one after it is resolved. When
 * every qualifying candidate turns out to be recently shown, the walk repeats without the
 * memory — the same "prefer what has not been shown, but show a repeat rather than nothing"
 * the other two sources apply to a list they can filter up front. The second pass is served
 * entirely from the MusicBrainz cache the first one filled.
 */
async function selectAlbum(
  walk: SelectionWalk
): Promise<AlbumSelection | null> {
  const picked = await walkCandidates(walk);
  if (picked || walk.recentlyShown.size === 0) return picked;
  return walkCandidates({ ...walk, recentlyShown: new Set() });
}

/**
 * The genre's chart walked down to one record worth recommending. This is the fallback
 * source: it knows nothing about the user past one tag string, which is why it converges on
 * the canonical famous records of a genre — but it is also the only source that works before
 * a similar-artist graph exists, so it stays.
 */
export async function walkTagPool(
  pool: TagAlbumPool | null,
  ctx: TagWalkContext
): Promise<BuiltAlbum | null> {
  if (!pool) return null;

  const picked = await selectAlbum({
    candidates: pool.albums,
    getRgInfo: (mbid) => resolveReleaseGroupInfo(mbid, ctx.priority),
    recentlyShown: ctx.recentlyShown,
    budget: ctx.budget,
    ...preferenceRule(ctx.libraryPreference, ctx.artistInLibrary),
  });
  if (!picked) return null;

  const library = ctx.albumLibrary(picked.rgMbid);

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
    tag: pool.tag.name,
    inLibrary: library !== null,
    library,
  };

  return { result, rememberKey: picked.rgMbid };
}
