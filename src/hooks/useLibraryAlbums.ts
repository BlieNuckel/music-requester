import { useState, useEffect, useMemo } from "react";

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

export type TrackAvailability = {
  available: number;
  total: number;
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

  const getTrackAvailability = (
    albumMbid: string
  ): TrackAvailability | null => {
    const stats = libraryAlbumsByMbid.get(albumMbid)?.statistics;
    if (!stats || stats.totalTrackCount === 0) return null;
    return { available: stats.trackFileCount, total: stats.totalTrackCount };
  };

  return { isAlbumInLibrary, getTrackAvailability };
}
