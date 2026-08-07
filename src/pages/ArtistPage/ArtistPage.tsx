import { useMemo } from "react";
import { useParams } from "react-router-dom";
import useArtistDetails from "@/hooks/useArtistDetails";
import useLibraryAlbums from "@/hooks/useLibraryAlbums";
import useLibraryArtists from "@/hooks/useLibraryArtists";
import useSimilarArtists from "@/hooks/useSimilarArtists";
import { groupArtistReleases } from "@/utils/groupArtistReleases";
import ArtistHeader from "./components/ArtistHeader";
import ReleaseSectionGrid from "./components/ReleaseSectionGrid";
import SimilarArtists from "./components/SimilarArtists";
import ArtistPageSkeleton from "./components/ArtistPageSkeleton";

export default function ArtistPage() {
  const { mbid } = useParams<{ mbid: string }>();
  const { artist, releaseGroups, loading, error } = useArtistDetails(mbid);
  const { isAlbumInLibrary } = useLibraryAlbums();
  const { isArtistInLibrary } = useLibraryArtists();
  const { artists: similarArtists, loading: similarLoading } =
    useSimilarArtists(artist?.name, mbid);

  const sections = useMemo(
    () => (mbid ? groupArtistReleases(releaseGroups, mbid) : []),
    [releaseGroups, mbid]
  );

  if (loading) return <ArtistPageSkeleton />;

  if (error || !artist) {
    return (
      <div className="mt-16 flex flex-col items-center text-gray-400 animate-fade-in">
        <p className="text-lg font-medium text-gray-500">
          {error ?? "Artist not found"}
        </p>
        <p className="mt-1 text-center">
          We couldn&apos;t load this artist. Try again from search.
        </p>
      </div>
    );
  }

  return (
    <div>
      <ArtistHeader
        artist={artist}
        inLibrary={isArtistInLibrary(mbid ?? "", artist.name)}
      />

      {sections.length === 0 ? (
        <p className="text-gray-400 dark:text-gray-500 text-sm">
          No releases found for this artist.
        </p>
      ) : (
        sections.map((section, index) => (
          <ReleaseSectionGrid
            key={section.title}
            title={section.title}
            items={section.items}
            defaultExpanded={index === 0}
            isAlbumInLibrary={isAlbumInLibrary}
          />
        ))
      )}

      <SimilarArtists
        artists={similarArtists}
        loading={similarLoading}
        isArtistInLibrary={isArtistInLibrary}
      />
    </div>
  );
}
