import { useRef, useState } from "react";
import Skeleton from "@/components/Skeleton";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import useHaptics from "@/hooks/useHaptics";
import type { PromotedAlbumData } from "@/hooks/usePromotedAlbums";
import PromotedAlbumCard from "./PromotedAlbumCard";
import SectionHeader from "./SectionHeader";
import ShuffleButton from "./ShuffleButton";

interface PromotedAlbumCarouselProps {
  albums: PromotedAlbumData[];
  loading: boolean;
  /** The server is still building this user's taste profile; there is nothing to show yet. */
  building?: boolean;
  /** Set when the load failed outright, so the tile offers a retry instead of vanishing. */
  error?: string | null;
  onRefresh: () => void;
}

interface CarouselDotsProps {
  count: number;
  activeIndex: number;
  onSelect: (index: number) => void;
}

const SHUFFLE_ANIMATION_MS = 300;

/** Horizontal travel needed before a touch drag counts as a slide change. */
const SWIPE_THRESHOLD_PX = 40;

const FRAME_CLASSES =
  "relative flex-1 lg:min-h-80 bg-white dark:bg-gray-800 rounded-xl border-2 border-black shadow-cartoon-md overflow-hidden flex flex-col";

const ARROW_CLASSES =
  "hidden lg:flex absolute top-1/2 -translate-y-1/2 z-10 items-center justify-center w-8 h-8 rounded-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-2 border-black shadow-cartoon-sm hover:shadow-cartoon-md active:shadow-cartoon-pressed transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-cartoon-sm";

function CarouselDots({ count, activeIndex, onSelect }: CarouselDotsProps) {
  return (
    <div className="flex items-center gap-1.5" role="tablist">
      {[...Array(count)].map((_, i) => (
        <button
          key={i}
          role="tab"
          aria-selected={i === activeIndex}
          aria-label={`Show recommendation ${i + 1}`}
          onClick={() => onSelect(i)}
          className={`h-2 rounded-full border-2 border-black transition-all ${
            i === activeIndex
              ? "w-5 bg-amber-400"
              : "w-2 bg-white dark:bg-gray-700 hover:bg-amber-100 dark:hover:bg-gray-600"
          }`}
        />
      ))}
    </div>
  );
}

function BuildingNotice() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
      <Skeleton className="h-5 w-40" />
      <p className="text-sm font-bold text-gray-700 dark:text-gray-300">
        Building your taste profile
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xs">
        Reading your Plex listening history and looking up the artists. This can
        take a few minutes the first time, and recommendations appear here as
        soon as it finishes.
      </p>
    </div>
  );
}

function LoadErrorNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-sm font-bold text-gray-700 dark:text-gray-300">
        Couldn&apos;t load recommendations
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xs">
        MusicBrainz or Last.fm may be busy. Nothing is wrong with your library.
      </p>
      <button
        onClick={onRetry}
        className="mt-2 px-3 py-1.5 text-sm font-bold rounded-lg bg-amber-300 hover:bg-amber-200 text-black border-2 border-black shadow-cartoon-sm hover:shadow-cartoon-md active:shadow-cartoon-pressed transition-all"
      >
        Try again
      </button>
    </div>
  );
}

function CarouselSkeleton() {
  return (
    <div className="flex-1 flex flex-col sm:flex-row">
      <Skeleton className="w-full sm:w-48 lg:w-72 aspect-square sm:aspect-auto sm:h-48 lg:h-auto rounded-none" />
      <div className="flex-1 p-4 space-y-3">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-5 w-32 rounded-full mt-2" />
      </div>
    </div>
  );
}

export default function PromotedAlbumCarousel({
  albums,
  loading,
  building = false,
  error = null,
  onRefresh,
}: PromotedAlbumCarouselProps) {
  const [index, setIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const haptics = useHaptics();

  const activeIndex = Math.min(index, Math.max(albums.length - 1, 0));
  const failed = Boolean(error) && albums.length === 0;
  const showControls = !loading && !building && albums.length > 1;

  const goTo = (next: number) => {
    if (next < 0 || next >= albums.length || next === activeIndex) return;
    haptics.light();
    setIndex(next);
  };

  const handleRefresh = () => {
    if (loading || building || isAnimating) return;
    setIsAnimating(true);
    setTimeout(() => {
      setIndex(0);
      onRefresh();
      setTimeout(() => setIsAnimating(false), 50);
    }, SHUFFLE_ANIMATION_MS);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const startX = touchStartX.current;
    touchStartX.current = null;
    if (startX === null) return;

    const delta = (e.changedTouches[0]?.clientX ?? startX) - startX;
    if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
    goTo(delta < 0 ? activeIndex + 1 : activeIndex - 1);
  };

  return (
    <div className="h-full flex flex-col">
      <SectionHeader
        title="Recommended for you"
        action={
          <div className="flex items-center gap-3">
            {showControls && (
              <CarouselDots
                count={albums.length}
                activeIndex={activeIndex}
                onSelect={goTo}
              />
            )}
            <ShuffleButton
              onClick={handleRefresh}
              disabled={isAnimating || loading || building}
              spinning={isAnimating || loading}
              ariaLabel="Shuffle recommendations"
            />
          </div>
        }
      />

      <div
        className={`${FRAME_CLASSES} transition-all duration-300 ${
          isAnimating
            ? "opacity-0 -translate-x-4 scale-95"
            : "opacity-100 translate-x-0 scale-100"
        }`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        role="group"
        aria-roledescription="carousel"
        aria-label="Recommended albums"
      >
        {building ? (
          <BuildingNotice />
        ) : loading ? (
          <CarouselSkeleton />
        ) : failed ? (
          <LoadErrorNotice onRetry={onRefresh} />
        ) : (
          <div
            className="flex flex-1 min-h-0 transition-transform duration-300 ease-out"
            style={{ transform: `translateX(-${activeIndex * 100}%)` }}
          >
            {albums.map((data, i) => (
              <div
                key={data.album.mbid}
                className="w-full shrink-0 flex flex-col"
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${albums.length}`}
                inert={i !== activeIndex}
              >
                <PromotedAlbumCard data={data} />
              </div>
            ))}
          </div>
        )}

        {showControls && (
          <>
            <button
              onClick={() => goTo(activeIndex - 1)}
              disabled={activeIndex === 0}
              aria-label="Previous recommendation"
              className={`${ARROW_CLASSES} left-3`}
            >
              <ChevronLeftIcon className="w-5 h-5" />
            </button>
            <button
              onClick={() => goTo(activeIndex + 1)}
              disabled={activeIndex === albums.length - 1}
              aria-label="Next recommendation"
              className={`${ARROW_CLASSES} right-3`}
            >
              <ChevronRightIcon className="w-5 h-5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
