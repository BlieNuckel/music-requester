import { CheckIcon, MinusIcon } from "./icons";
import {
  albumLibraryLabel,
  albumLibraryTitle,
  type AlbumLibraryInfo,
  type AlbumLibraryState,
} from "@shared/albumLibrary";

interface AlbumLibraryBadgeProps {
  state: AlbumLibraryState;
  label: string;
  className?: string;
}

interface AlbumLibraryPillProps {
  info: AlbumLibraryInfo;
  className?: string;
}

const CIRCLE_CLASSES: Record<AlbumLibraryState, string> = {
  complete: "bg-amber-300 text-black",
  partial: "bg-amber-300 text-black",
  requested: "bg-gray-200 dark:bg-gray-500 text-black dark:text-white",
};

const PILL_CLASSES: Record<AlbumLibraryState, string> = {
  complete: "bg-amber-300 text-black",
  partial: "bg-amber-300 text-black",
  requested: "bg-gray-200 dark:bg-gray-500 text-black dark:text-white",
};

/** Circular badge overlaid on album cover art. */
export default function AlbumLibraryBadge({
  state,
  label,
  className = "",
}: AlbumLibraryBadgeProps) {
  const Icon = state === "complete" ? CheckIcon : MinusIcon;

  return (
    <span
      className={`flex items-center justify-center w-5 h-5 rounded-full border-2 border-black shadow-cartoon-sm ${CIRCLE_CLASSES[state]} ${className}`}
      aria-label={label}
      title={label}
    >
      <Icon className="w-3 h-3" />
    </span>
  );
}

/** Text pill for headers, where there is room to state the track count. */
export function AlbumLibraryPill({
  info,
  className = "",
}: AlbumLibraryPillProps) {
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded-full border-2 border-black font-bold shadow-cartoon-sm whitespace-nowrap ${PILL_CLASSES[info.state]} ${className}`}
      title={albumLibraryTitle(info)}
    >
      {albumLibraryLabel(info)}
    </span>
  );
}
