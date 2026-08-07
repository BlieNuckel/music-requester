import NodeCache from "node-cache";
import { withCache } from "../../cache";
import { resilientFetch } from "../resilientFetch";
import { createLogger } from "../../logger";
import type {
  DeezerArtistSearchResponse,
  DeezerAlbum,
  DeezerAlbumsResponse,
  DeezerAlbumSearchResponse,
} from "./types";

const log = createLogger("Deezer Albums");

const DEEZER_BASE = "https://api.deezer.com";
const ONE_DAY_SECONDS = 24 * 60 * 60;

const deezerAlbumCache = new NodeCache({ stdTTL: 7 * ONE_DAY_SECONDS });

async function findDeezerArtistId(artistName: string): Promise<number | null> {
  try {
    const params = new URLSearchParams({ q: artistName, limit: "1" });
    const response = await resilientFetch(
      `${DEEZER_BASE}/search/artist?${params.toString()}`
    );
    if (!response.ok) return null;
    const data: DeezerArtistSearchResponse = await response.json();
    if (data.data?.length > 0) {
      return data.data[0].id;
    }
    return null;
  } catch (error) {
    log.error(`Error looking up Deezer artist for ${artistName}`, error);
    return null;
  }
}

/**
 * Fetch the most recent albums for an artist on Deezer.
 * Resolves the Deezer artist id by name (best-effort).
 */
export async function getArtistAlbumsByName(
  artistName: string,
  limit = 25
): Promise<DeezerAlbum[]> {
  const artistId = await findDeezerArtistId(artistName);
  if (artistId === null) return [];

  try {
    const url = `${DEEZER_BASE}/artist/${artistId}/albums?limit=${limit}`;
    const response = await resilientFetch(url);
    if (!response.ok) {
      log.error(
        `Failed to fetch albums for Deezer artist ${artistId}: ${response.status}`
      );
      return [];
    }
    const data: DeezerAlbumsResponse = await response.json();
    return data.data ?? [];
  } catch (error) {
    log.error(`Error fetching Deezer albums for ${artistName}`, error);
    return [];
  }
}

/**
 * Search Deezer for a specific album by name and return its cover URL.
 * @returns cover_xl (1000x1000) or empty string if not found
 */
const fetchAlbumArtwork = async (
  albumName: string,
  artistName: string
): Promise<string> => {
  try {
    const params = new URLSearchParams({
      q: `artist:"${artistName}" album:"${albumName}"`,
      limit: "1",
    });
    const response = await resilientFetch(
      `${DEEZER_BASE}/search/album?${params.toString()}`
    );
    if (!response.ok) {
      log.error(
        `Failed to fetch album artwork for ${albumName} by ${artistName}: ${response.status}`
      );
      return "";
    }
    const data: DeezerAlbumSearchResponse = await response.json();
    const album = data.data?.[0];
    return album?.cover_xl ?? album?.cover ?? "";
  } catch (error) {
    log.error(`Error fetching Deezer album artwork for ${albumName}`, error);
    return "";
  }
};

export const getAlbumArtwork = withCache(fetchAlbumArtwork, {
  cache: deezerAlbumCache,
  key: (albumName, artistName) =>
    `${albumName.toLowerCase()}|${artistName.toLowerCase()}`,
  ttlMs: 7 * ONE_DAY_SECONDS * 1000,
  label: "Deezer API",
});

/**
 * Batch fetch album cover URLs.
 * @returns Map of "albumName|artistName" (lowercase) to cover URL
 */
export const getAlbumsArtwork = async (
  albums: Array<{ name: string; artistName: string }>
): Promise<Map<string, string>> => {
  const results = await Promise.all(
    albums.map(async ({ name, artistName }) => {
      const artworkUrl = await getAlbumArtwork(name, artistName);
      const key = `${name.toLowerCase()}|${artistName.toLowerCase()}`;
      return { key, artworkUrl };
    })
  );

  return new Map(results.map((r) => [r.key, r.artworkUrl]));
};
