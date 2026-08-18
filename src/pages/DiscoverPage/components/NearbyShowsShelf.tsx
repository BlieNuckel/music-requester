import { Link } from "react-router-dom";
import SectionHeader from "./SectionHeader";
import NearbyShowCard from "./NearbyShowCard";
import type { NearbyShow } from "@/types";

interface NearbyShowsShelfProps {
  shows: NearbyShow[];
}

/** As many entries as the tile fits as cards. Rest on /library/live. */
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

function subtitle(show: NearbyShow): string {
  return [show.venueName, formatDate(show.eventDate)]
    .filter(Boolean)
    .join(" · ");
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

      {/* No container: the cards are the widget. The gap clears each card's own
          drop shadow so the one below it isn't overlapped. */}
      <ul className="flex-1 min-h-0 flex flex-col gap-3">
        {visible.map((show) => (
          <NearbyShowCard
            key={show.eventKey}
            show={show}
            headliner={headliner(show)}
            subtitle={subtitle(show)}
          />
        ))}
      </ul>
    </div>
  );
}
