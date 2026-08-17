import useLiveNotice from "@/hooks/useLiveNotice";
import useReportSectionStatus from "../../useReportSectionStatus";
import LiveBanner from "../LiveBanner";
import type { SectionComponentProps } from "../../types";

export default function LiveBannerSection({
  onStatusChange,
}: SectionComponentProps) {
  const { notice, additionalCount, loading, error, respond } = useLiveNotice();

  useReportSectionStatus(onStatusChange, {
    loading,
    error: Boolean(error),
    empty: notice === null,
  });

  // A notice is either worth interrupting for or it is not; a skeleton for an
  // announcement that usually does not exist would be its own kind of noise.
  if (!notice) return null;

  return (
    <LiveBanner
      notice={notice}
      additionalCount={additionalCount}
      onRespond={respond}
    />
  );
}
