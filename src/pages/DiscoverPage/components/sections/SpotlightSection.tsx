import usePromotedAlbums from "@/hooks/usePromotedAlbums";
import useReportSectionStatus from "../../useReportSectionStatus";
import PromotedAlbumCarousel from "../PromotedAlbumCarousel";
import type { SectionComponentProps } from "../../types";

export default function SpotlightSection({
  onStatusChange,
}: SectionComponentProps) {
  const { promotedAlbums, building, loading, error, refresh } =
    usePromotedAlbums();

  useReportSectionStatus(onStatusChange, {
    loading: loading || building,
    error: Boolean(error),
    empty: promotedAlbums.length === 0 && !building,
  });

  if (promotedAlbums.length === 0 && !loading && !building && !error) {
    return null;
  }

  return (
    <PromotedAlbumCarousel
      albums={promotedAlbums}
      loading={loading}
      building={building}
      error={error}
      onRefresh={refresh}
    />
  );
}
