import { Link } from "react-router-dom";
import ImageWithShimmer from "@/components/ImageWithShimmer";
import { MusicalNoteIcon, SearchIcon, TicketIcon } from "@/components/icons";
import type { NearbyShow } from "@/types";

interface NearbyShowCardProps {
  show: NearbyShow;
  headliner: string;
  subtitle: string;
}

const ACTION_CLASSES =
  "flex-1 flex items-center justify-center gap-1 h-7 px-2 rounded-lg border-2 border-black shadow-cartoon-sm text-[11px] font-semibold hover:translate-y-[-1px] hover:shadow-cartoon-md active:translate-y-[1px] active:shadow-cartoon-pressed transition-all";

export default function NearbyShowCard({
  show,
  headliner,
  subtitle,
}: NearbyShowCardProps) {
  const image = show.imageUrl ?? show.artistImageUrl;
  const searchHref = `/search?${new URLSearchParams({ q: headliner }).toString()}`;

  return (
    // flex-1 rather than a fixed height: the tile is a fixed number of grid rows,
    // so cards share whatever is there instead of leaving the bottom blank.
    <li className="flex-1 min-h-0 flex items-center gap-2.5 rounded-xl border-2 border-black bg-white dark:bg-gray-800 shadow-cartoon-md p-2">
      {/* Scales with the card, so a shelf with one show gets a bigger image
          rather than the same small one and a lot of white. */}
      <div className="shrink-0 h-full max-h-24 aspect-square rounded-md overflow-hidden border-2 border-black bg-amber-100 dark:bg-gray-700">
        {image ? (
          <ImageWithShimmer
            src={image}
            alt={headliner}
            className="w-full h-full object-cover"
            wrapperClassName="w-full h-full"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <MusicalNoteIcon className="w-5 h-5 text-amber-400 dark:text-amber-500" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {headliner}
            </span>
            {show.following && (
              <span
                title="You follow this artist"
                className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded border border-black bg-emerald-300 text-black"
              >
                Following
              </span>
            )}
          </div>
          <span className="block text-xs text-gray-600 dark:text-gray-400 truncate">
            {subtitle}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to={searchHref}
            aria-label={`Search for ${headliner}`}
            title={`Search for ${headliner}`}
            className={`${ACTION_CLASSES} bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100`}
          >
            <SearchIcon className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Search</span>
          </Link>

          {show.ticketUrl && (
            <a
              href={show.ticketUrl}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`Tickets for ${headliner}`}
              title={`Tickets for ${headliner}`}
              className={`${ACTION_CLASSES} bg-orange-400 text-black`}
            >
              <TicketIcon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Tickets</span>
            </a>
          )}
        </div>
      </div>
    </li>
  );
}
