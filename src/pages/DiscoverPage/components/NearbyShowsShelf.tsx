import { Link } from "react-router-dom";
import SectionHeader from "./SectionHeader";
import type { NearbyShow } from "@/types";

interface NearbyShowsShelfProps {
  shows: NearbyShow[];
}

/** As many entries as fit the tile's three rows without scrolling. Rest on /library/live. */
const MAX_VISIBLE = 4;

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
};

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, DATE_FORMAT);
}

function headliner(show: NearbyShow): string {
  const lead = show.performers.find((performer) => performer.isHeadliner);
  return lead?.name ?? show.performers[0]?.name ?? show.name;
}

export default function NearbyShowsShelf({ shows }: NearbyShowsShelfProps) {
  const visible = shows.slice(0, MAX_VISIBLE);

  return (
    <div className="h-full flex flex-col">
      <SectionHeader
        title="Nearby"
        action={
          shows.length > MAX_VISIBLE ? (
            <Link
              to="/library/live"
              className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              See all
            </Link>
          ) : undefined
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto overlay-scrollbar bg-white dark:bg-gray-800 rounded-xl border-2 border-black shadow-cartoon-md p-4">
        <ul className="flex flex-col gap-3">
          {visible.map((show) => (
            <li key={show.eventKey} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                  {headliner(show)}
                </span>
                {show.following && (
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border-2 border-black bg-emerald-300 text-black">
                    Following
                  </span>
                )}
              </div>

              <span className="text-xs text-gray-600 dark:text-gray-400 truncate">
                {[show.venueName, formatDate(show.eventDate)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>

              {show.ticketUrl && (
                <a
                  href={show.ticketUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors self-start"
                >
                  Tickets →
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
