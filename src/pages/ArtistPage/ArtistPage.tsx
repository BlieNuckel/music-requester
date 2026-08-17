import { useMemo } from "react";
import { useParams } from "react-router-dom";
import useArtistDetails from "@/hooks/useArtistDetails";
import useArtistReleaseGroups from "@/hooks/useArtistReleaseGroups";
import useLibraryAlbums from "@/hooks/useLibraryAlbums";
import useLibraryArtists from "@/hooks/useLibraryArtists";
import useSimilarArtists from "@/hooks/useSimilarArtists";
import useArtistLiveDates from "@/hooks/useArtistLiveDates";
import { groupArtistReleases } from "@/utils/groupArtistReleases";
import ArtistHeader from "./components/ArtistHeader";
import ArtistDiscography from "./components/ArtistDiscography";
import SimilarArtists from "./components/SimilarArtists";
import ArtistLiveDates from "./components/ArtistLiveDates";
import ArtistPageSkeleton from "./components/ArtistPageSkeleton";

export default function ArtistPage() {
  const { mbid } = useParams<{ mbid: string }>();
  const { artist, loading, error } = useArtistDetails(mbid);
  const {
    releaseGroups,
    loading: releasesLoading,
    error: releasesError,
  } = useArtistReleaseGroups(mbid);
  const { getAlbumLibrary } = useLibraryAlbums();
  const { isArtistInLibrary } = useLibraryArtists();
  const { artists: similarArtists, loading: similarLoading } =
    useSimilarArtists(artist?.name, mbid);
  const { dates: liveDates } = useArtistLiveDates(mbid);

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

      <ArtistLiveDates dates={liveDates} />

      <ArtistDiscography
        sections={sections}
        loading={releasesLoading}
        error={releasesError}
        getAlbumLibrary={getAlbumLibrary}
      />

      <SimilarArtists
        artists={similarArtists}
        loading={similarLoading}
        isArtistInLibrary={isArtistInLibrary}
      />
    </div>
  );
}
