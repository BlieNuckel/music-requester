import useNewReleases from "@/hooks/useNewReleases";
import useReportSectionStatus from "../../useReportSectionStatus";
import NewReleasesShelf from "../NewReleasesShelf";
import type { SectionComponentProps } from "../../types";

export default function NewReleasesSection({
  onStatusChange,
}: SectionComponentProps) {
  const { newReleases, loading, error } = useNewReleases();

  useReportSectionStatus(onStatusChange, {
    loading,
    error: Boolean(error),
    empty: (newReleases?.items ?? []).length === 0,
  });

  if (!newReleases && !loading) return null;

  return <NewReleasesShelf data={newReleases} loading={loading} />;
}
