import { resilientFetch } from "../resilientFetch";
import { buildUrl } from "./config";
import type {
  LastfmTagAlbumsResponse,
  LastfmAlbumTopTagsResponse,
  LastfmArtistTopAlbumsResponse,
} from "./types";

export type LastfmAlbumSummary = {
  name: string;
  mbid: string;
  artistName: string;
  artistMbid: string;
  imageUrl: string;
};

function pickImageUrl(
  image: Array<{ "#text": string; size: string }> | undefined
): string {
  const large = image?.find((img) => img.size === "large");
  const extralarge = image?.find((img) => img.size === "extralarge");
  return extralarge?.["#text"] || large?.["#text"] || "";
}

export const getTopAlbumsByTag = async (
  tag: string,
  page = "1",
  limit = "50"
) => {
  const url = buildUrl("tag.getTopAlbums", { tag, page, limit });
  const response = await resilientFetch(url);
  const data: LastfmTagAlbumsResponse = await response.json();

  if (data.error) {
    throw new Error(data.message || "Last.fm API error");
  }

  const albumsContainer = data.albums;
  const albums: LastfmAlbumSummary[] = (albumsContainer?.album || []).map(
    (a) => ({
      name: a.name,
      mbid: a.mbid || "",
      artistName: a.artist?.name || "",
      artistMbid: a.artist?.mbid || "",
      imageUrl: pickImageUrl(a.image),
    })
  );

  const attr = albumsContainer?.["@attr"];
  return {
    albums,
    pagination: {
      page: Number(attr?.page) || 1,
      totalPages: Number(attr?.totalPages) || 1,
    },
  };
};

export async function getAlbumTopTags(
  artist: string,
  album: string
): Promise<{ name: string; count: number }[]> {
  const url = buildUrl("album.getTopTags", { artist, album });
  const response = await resilientFetch(url);
  const data: LastfmAlbumTopTagsResponse = await response.json();

  if (data.error) {
    throw new Error(data.message || "Last.fm API error");
  }

  return (data.toptags?.tag || []).map((t) => ({
    name: t.name,
    count: Number(t.count),
  }));
}

/**
 * An artist's albums ordered by global play count. MusicBrainz has no popularity
 * signal, so this is the only way to pick the album an artist is actually known
 * for rather than an arbitrary one from their discography.
 */
export async function getArtistTopAlbums(
  artist: string,
  limit = "10"
): Promise<LastfmAlbumSummary[]> {
  const url = buildUrl("artist.getTopAlbums", { artist, limit });
  const response = await resilientFetch(url);
  const data: LastfmArtistTopAlbumsResponse = await response.json();

  if (data.error) {
    throw new Error(data.message || "Last.fm API error");
  }

  return (data.topalbums?.album || []).map((a) => ({
    name: a.name,
    mbid: a.mbid || "",
    artistName: a.artist?.name || artist,
    artistMbid: a.artist?.mbid || "",
    imageUrl: pickImageUrl(a.image),
  }));
}
