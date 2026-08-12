import Skeleton from "@/components/Skeleton";

interface ReleaseGridSkeletonProps {
  count?: number;
}

export default function ReleaseGridSkeleton({
  count = 4,
}: ReleaseGridSkeletonProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 sm:gap-4">
      {[...Array(count)].map((_, i) => (
        <div
          key={i}
          className="hidden sm:block bg-white dark:bg-gray-800 rounded-xl border-2 border-black shadow-cartoon-sm overflow-hidden"
        >
          <Skeleton className="aspect-square rounded-none" />
          <div className="p-3 border-t-2 border-black space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
