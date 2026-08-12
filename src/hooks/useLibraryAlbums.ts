import { useState, useEffect, useMemo } from "react";
import {
  deriveAlbumLibraryInfo,
  type AlbumLibraryInfo,
} from "@shared/albumLibrary";

type LibraryAlbum = {
  id: number;
  title: string;
  foreignAlbumId: string;
  monitored: boolean;
  statistics?: {
    trackFileCount: number;
    totalTrackCount: number;
    percentOfTracks: number;
  };
};

export default function useLibraryAlbums() {
  const [libraryAlbums, setLibraryAlbums] = useState<LibraryAlbum[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/lidarr/albums");
        if (res.ok) {
          setLibraryAlbums(await res.json());
        }
      } catch {
        // Library may not be configured yet
      }
    };
    load();
  }, []);

  const libraryAlbumsByMbid = useMemo(
    () => new Map(libraryAlbums.map((a) => [a.foreignAlbumId, a])),
    [libraryAlbums]
  );

  const isAlbumInLibrary = (albumMbid: string) =>
    libraryAlbumsByMbid.has(albumMbid);

  const getAlbumLibrary = (albumMbid: string): AlbumLibraryInfo | null => {
    const album = libraryAlbumsByMbid.get(albumMbid);
    if (!album) return null;
    return deriveAlbumLibraryInfo(album.statistics);
  };

  return { isAlbumInLibrary, getAlbumLibrary };
}
