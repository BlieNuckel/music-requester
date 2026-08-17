import useNearbyShows from "@/hooks/useNearbyShows";
import useReportSectionStatus from "../../useReportSectionStatus";
import NearbyShowsShelf from "../NearbyShowsShelf";
import type { SectionComponentProps } from "../../types";

export default function NearbyShowsSection({
  onStatusChange,
}: SectionComponentProps) {
  const { shows, loading, error } = useNearbyShows();

  useReportSectionStatus(onStatusChange, {
    loading,
    error: Boolean(error),
    empty: shows.length === 0,
  });

  if (shows.length === 0) return null;

  return <NearbyShowsShelf shows={shows} />;
}
