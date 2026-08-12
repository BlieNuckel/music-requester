import usePromotedAlbums from "@/hooks/usePromotedAlbums";
import useReportSectionStatus from "../../useReportSectionStatus";
import PromotedAlbumCarousel from "../PromotedAlbumCarousel";
import type { SectionComponentProps } from "../../types";

export default function SpotlightSection({
  onStatusChange,
}: SectionComponentProps) {
  const { promotedAlbums, loading, error, refresh } = usePromotedAlbums();

  useReportSectionStatus(onStatusChange, {
    loading,
    error: Boolean(error),
    empty: promotedAlbums.length === 0,
  });

  if (promotedAlbums.length === 0 && !loading) return null;

  return (
    <PromotedAlbumCarousel
      albums={promotedAlbums}
      loading={loading}
      onRefresh={refresh}
    />
  );
}
