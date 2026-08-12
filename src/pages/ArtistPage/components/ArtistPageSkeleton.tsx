import Skeleton from "@/components/Skeleton";
import ReleaseGridSkeleton from "./ReleaseGridSkeleton";

export default function ArtistPageSkeleton() {
  return (
    <div>
      <div className="flex items-center gap-4 mb-8">
        <Skeleton className="w-20 h-20 sm:w-28 sm:h-28 rounded-xl flex-shrink-0" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>
      </div>
      <Skeleton className="h-4 w-24 mb-3" />
      <ReleaseGridSkeleton />
    </div>
  );
}
