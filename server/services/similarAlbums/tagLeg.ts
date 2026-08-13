import { getAlbumTopTags, getTopAlbumsByTag } from "../../api/lastfm/albums";
import { createLogger } from "../../logger";
import type { AlbumCandidate, SeedAlbum } from "./types";

/** Tags of the seed album to fan out from, strongest first. */
const TAGS_USED = 3;

/** How far down each tag's global chart to read. */
const CANDIDATES_PER_TAG = 25;

const log = createLogger("similarAlbums");

/**
 * The seed album's own genre fingerprint: its top non-generic tags, strongest first.
 * Generic tags ("seen live", "favorites") describe the listener rather than the record,
 * so a chart built off them says nothing about similarity.
 */
export async function selectSeedTags(
  seed: SeedAlbum,
  genericTags: Set<string>
): Promise<string[]> {
  let tags: { name: string; count: number }[];
  try {
    tags = await getAlbumTopTags(seed.artistName, seed.title);
  } catch (err) {
    log.warn(`album.getTopTags failed for ${seed.artistName} - ${seed.title}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  return tags
    .filter((t) => t.name && !genericTags.has(t.name.toLowerCase()))
    .sort((a, b) => b.count - a.count)
    .slice(0, TAGS_USED)
    .map((t) => t.name);
}

async function candidatesForTag(
  tag: string,
  tagWeight: number
): Promise<AlbumCandidate[]> {
  let albums: Awaited<ReturnType<typeof getTopAlbumsByTag>>["albums"];
  try {
    albums = (await getTopAlbumsByTag(tag, "1")).albums;
  } catch (err) {
    log.warn(`tag.getTopAlbums failed for ${tag}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  return albums.slice(0, CANDIDATES_PER_TAG).map((album, index) => ({
    title: album.name,
    artistName: album.artistName,
    artistMbid: album.artistMbid,
    mbid: album.mbid,
    score: tagWeight * ((CANDIDATES_PER_TAG - index) / CANDIDATES_PER_TAG),
    reason: "tag" as const,
  }));
}

/**
 * "Albums sharing this album's genre fingerprint." Scores a candidate by how strong
 * the tag it came from was on the seed and how high it ranks on that tag's chart, so
 * the top of the seed's strongest tag outranks the tail of its third-strongest.
 */
export async function collectTagCandidates(
  seed: SeedAlbum,
  genericTags: Set<string>
): Promise<AlbumCandidate[]> {
  const tags = await selectSeedTags(seed, genericTags);
  if (tags.length === 0) return [];

  const perTag = await Promise.all(
    tags.map((tag, index) =>
      candidatesForTag(tag, (TAGS_USED - index) / TAGS_USED)
    )
  );

  return perTag.flat();
}
