import { Link } from "react-router-dom";
import Skeleton from "@/components/Skeleton";
import SectionHeader from "./SectionHeader";
import NewReleaseCard from "./NewReleaseCard";
import type { NewReleasesData } from "@/types";

interface NewReleasesShelfProps {
  data: NewReleasesData | null;
  loading: boolean;
}

const SKELETON_COUNT = 6;

const SHELF_CLASSES =
  "flex overflow-x-auto snap-x snap-mandatory gap-3 pb-1 lg:pb-0 lg:grid lg:grid-cols-6 lg:gap-4 lg:overflow-visible";

const ITEM_CLASSES = "snap-start shrink-0 w-28 lg:w-auto lg:shrink";

export default function NewReleasesShelf({
  data,
  loading,
}: NewReleasesShelfProps) {
  const items = data?.items ?? [];

  if (!loading && items.length === 0) return null;

  return (
    <div className="h-full flex flex-col">
      <SectionHeader
        title="New releases"
        action={
          <Link
            to="/library/following"
            className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            See all
          </Link>
        }
      />

      <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl border-2 border-black shadow-cartoon-md p-4">
        <div className={SHELF_CLASSES}>
          {loading
            ? [...Array(SKELETON_COUNT)].map((_, i) => (
                <div key={i} className={`${ITEM_CLASSES} flex flex-col`}>
                  <Skeleton className="w-full aspect-square rounded-xl" />
                  <Skeleton className="mt-2 h-3 w-3/4" />
                  <Skeleton className="mt-1 h-2.5 w-1/2" />
                </div>
              ))
            : items.map((item) => (
                <div
                  key={
                    item.releaseGroupMbid ?? `${item.artistName}-${item.title}`
                  }
                  className={ITEM_CLASSES}
                >
                  <NewReleaseCard item={item} />
                </div>
              ))}
        </div>
      </div>
    </div>
  );
}
