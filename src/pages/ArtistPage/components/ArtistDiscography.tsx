import Skeleton from "@/components/Skeleton";
import ReleaseGridSkeleton from "./ReleaseGridSkeleton";
import ReleaseSectionGrid from "./ReleaseSectionGrid";
import type { ReleaseSection } from "@/utils/groupArtistReleases";
import type { AlbumLibraryInfo } from "@shared/albumLibrary";

interface ArtistDiscographyProps {
  sections: ReleaseSection[];
  loading: boolean;
  error: string | null;
  getAlbumLibrary?: (albumMbid: string) => AlbumLibraryInfo | null;
}

export default function ArtistDiscography({
  sections,
  loading,
  error,
  getAlbumLibrary,
}: ArtistDiscographyProps) {
  if (loading) {
    return (
      <section className="mb-8">
        <Skeleton className="h-4 w-24 mb-3" />
        <ReleaseGridSkeleton />
      </section>
    );
  }

  if (error) {
    return (
      <p className="text-gray-400 dark:text-gray-500 text-sm mb-8">
        We couldn&apos;t load this artist&apos;s releases.
      </p>
    );
  }

  if (sections.length === 0) {
    return (
      <p className="text-gray-400 dark:text-gray-500 text-sm mb-8">
        No releases found for this artist.
      </p>
    );
  }

  return (
    <>
      {sections.map((section, index) => (
        <ReleaseSectionGrid
          key={section.title}
          title={section.title}
          items={section.items}
          defaultExpanded={index === 0}
          getAlbumLibrary={getAlbumLibrary}
        />
      ))}
    </>
  );
}
