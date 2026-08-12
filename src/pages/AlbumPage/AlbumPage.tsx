import { useMemo } from "react";
import { useParams } from "react-router-dom";
import useReleaseGroupDetails from "@/hooks/useReleaseGroupDetails";
import useReleaseGroupLabel from "@/hooks/useReleaseGroupLabel";
import useArtistReleaseGroups from "@/hooks/useArtistReleaseGroups";
import useLibraryAlbums from "@/hooks/useLibraryAlbums";
import useWantedAlbums from "@/hooks/useWantedAlbums";
import ReleaseSectionGrid from "@/pages/ArtistPage/components/ReleaseSectionGrid";
import AlbumHeader from "./components/AlbumHeader";
import AlbumTracklist from "./components/AlbumTracklist";
import AlbumPageSkeleton from "./components/AlbumPageSkeleton";

export default function AlbumPage() {
  const { mbid } = useParams<{ mbid: string }>();
  const { album, loading, error } = useReleaseGroupDetails(mbid);
  const { label } = useReleaseGroupLabel(mbid);
  const { releaseGroups, loading: moreLoading } = useArtistReleaseGroups(
    album?.artistMbid
  );
  const { isAlbumInLibrary, getAlbumLibrary } = useLibraryAlbums();
  const { isAlbumWanted } = useWantedAlbums();

  const otherReleases = useMemo(
    () => releaseGroups.filter((rg) => rg.id !== album?.mbid),
    [releaseGroups, album?.mbid]
  );

  if (loading) return <AlbumPageSkeleton />;

  if (error || !album) {
    return (
      <div className="mt-16 flex flex-col items-center text-gray-400 animate-fade-in">
        <p className="text-lg font-medium text-gray-500">
          {error ?? "Album not found"}
        </p>
        <p className="mt-1 text-center">
          We couldn&apos;t load this album. Try again from search.
        </p>
      </div>
    );
  }

  return (
    <div>
      <AlbumHeader
        album={album}
        label={label}
        inLibrary={isAlbumInLibrary(album.mbid)}
        initialWanted={isAlbumWanted(album.mbid)}
        library={getAlbumLibrary(album.mbid)}
      />

      <AlbumTracklist albumMbid={album.mbid} artistName={album.artistName} />

      {(moreLoading || otherReleases.length > 0) && (
        <ReleaseSectionGrid
          title="More from this artist"
          items={otherReleases}
          loading={moreLoading}
          getAlbumLibrary={getAlbumLibrary}
        />
      )}
    </div>
  );
}
