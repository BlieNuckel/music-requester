import { getArtistTopAlbums } from "../../api/lastfm/albums";
import { getSimilarArtists } from "../../api/listenbrainz/similarArtists";
import { createLogger } from "../../logger";
import { isPlaceholderArtist } from "../../utils/artistFilter";
import type { AlbumCandidate, SeedAlbum } from "./types";

/** Neighbours of the seed artist to draw albums from, most similar first. */
const SIMILAR_ARTISTS_USED = 12;

/** Albums per neighbour. Beyond the first few an artist's chart stops being representative. */
const ALBUMS_PER_ARTIST = 3;

type Neighbour = { name: string; artistMbid: string; weight: number };

const log = createLogger("similarAlbums");

async function albumsForNeighbour(
  neighbour: Neighbour
): Promise<AlbumCandidate[]> {
  let albums: Awaited<ReturnType<typeof getArtistTopAlbums>>;
  try {
    albums = await getArtistTopAlbums(
      neighbour.name,
      String(ALBUMS_PER_ARTIST)
    );
  } catch (err) {
    log.warn(`artist.getTopAlbums failed for ${neighbour.name}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  return albums.slice(0, ALBUMS_PER_ARTIST).map((album, index) => ({
    title: album.name,
    artistName: album.artistName || neighbour.name,
    artistMbid: neighbour.artistMbid,
    mbid: album.mbid,
    score: neighbour.weight * ((ALBUMS_PER_ARTIST - index) / ALBUMS_PER_ARTIST),
    reason: "artist" as const,
  }));
}

/**
 * ListenBrainz similarity scores are unbounded counts, not ratios, so they only mean
 * something relative to the strongest neighbour in the same response. Normalizing here
 * is what lets an artist-leg score be compared against a tag-leg one.
 */
export async function selectNeighbours(seed: SeedAlbum): Promise<Neighbour[]> {
  if (!seed.artistMbid) return [];

  const similar = (await getSimilarArtists(seed.artistMbid))
    .filter((a) => !isPlaceholderArtist(a.name, a.artist_mbid))
    .slice(0, SIMILAR_ARTISTS_USED);
  if (similar.length === 0) return [];

  const topScore = similar[0].score || 1;
  return similar.map((a) => ({
    name: a.name,
    artistMbid: a.artist_mbid,
    weight: Math.min(1, a.score / topScore),
  }));
}

/**
 * "Albums by artists like this one." Uses Last.fm's play-count ordering to pick each
 * neighbour's representative records — MusicBrainz has no popularity signal, so reading
 * a discography from there would surface an arbitrary release instead of a known one.
 */
export async function collectArtistCandidates(
  seed: SeedAlbum
): Promise<AlbumCandidate[]> {
  const neighbours = await selectNeighbours(seed);
  if (neighbours.length === 0) return [];

  const perArtist = await Promise.all(neighbours.map(albumsForNeighbour));
  return perArtist.flat();
}
