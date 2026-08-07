import { getArtistsImages } from "../api/deezer/artists";
import { getAlbumsArtwork } from "../api/deezer/albums";

type ArtistWithImage = { name: string; imageUrl: string };
type AlbumWithImage = { name: string; artistName: string; imageUrl: string };
type ArtistSection = { artists: ArtistWithImage[]; [key: string]: unknown };

export async function enrichArtistsWithImages<T extends ArtistWithImage>(
  artists: T[]
): Promise<T[]> {
  const imageMap = await getArtistsImages(artists.map((a) => a.name));
  return artists.map((a) => ({
    ...a,
    imageUrl: imageMap.get(a.name.toLowerCase()) || a.imageUrl,
  }));
}

export async function enrichArtistSectionsWithImages<T extends ArtistSection>(
  sections: T[]
): Promise<T[]> {
  const allArtistNames = sections.flatMap((s) => s.artists.map((a) => a.name));
  const imageMap = await getArtistsImages(allArtistNames);

  return sections.map((section) => ({
    ...section,
    artists: section.artists.map((a) => ({
      ...a,
      imageUrl: imageMap.get(a.name.toLowerCase()) || a.imageUrl,
    })),
  }));
}

export async function enrichAlbumsWithArtwork<T extends AlbumWithImage>(
  albums: T[]
): Promise<T[]> {
  const artworkMap = await getAlbumsArtwork(
    albums.map((a) => ({ name: a.name, artistName: a.artistName }))
  );

  return albums.map((a) => {
    const key = `${a.name.toLowerCase()}|${a.artistName.toLowerCase()}`;
    return {
      ...a,
      imageUrl: artworkMap.get(key) || a.imageUrl,
    };
  });
}
