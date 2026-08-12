import { useState } from "react";
import ReleaseGroupCard from "@/components/ReleaseGroupCard";
import ReleaseGridSkeleton from "./ReleaseGridSkeleton";
import { ChevronRightIcon } from "@/components/icons";
import type { ReleaseGroup } from "@/types";
import type { AlbumLibraryInfo } from "@shared/albumLibrary";

const DEAL_ROTATIONS = [-4, 3.5, -3, 4.5, -3.5, 3];

interface ReleaseSectionGridProps {
  title: string;
  items: ReleaseGroup[];
  defaultExpanded?: boolean;
  loading?: boolean;
  getAlbumLibrary?: (albumMbid: string) => AlbumLibraryInfo | null;
}

export default function ReleaseSectionGrid({
  title,
  items,
  defaultExpanded = false,
  loading = false,
  getAlbumLibrary,
}: ReleaseSectionGridProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <section className="mb-8">
      <h2 className="mb-3">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="flex w-full items-center gap-1 text-left text-gray-500 dark:text-gray-400 text-sm font-semibold uppercase tracking-wide cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          <ChevronRightIcon
            className={`w-4 h-4 transition-transform ${expanded ? "rotate-90" : ""}`}
          />
          {title}
          <span className="font-normal normal-case tracking-normal text-gray-400 dark:text-gray-500">
            {loading ? "(…)" : `(${items.length})`}
          </span>
        </button>
      </h2>
      {expanded && loading && <ReleaseGridSkeleton />}
      {expanded && !loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 sm:gap-4">
          {items.map((rg, index) => (
            <div
              key={rg.id}
              className="cascade-deal-in"
              style={
                {
                  "--deal-index": index,
                  "--deal-rotate": `${DEAL_ROTATIONS[index % DEAL_ROTATIONS.length]}deg`,
                } as React.CSSProperties
              }
            >
              <ReleaseGroupCard
                releaseGroup={rg}
                library={getAlbumLibrary?.(rg.id)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
