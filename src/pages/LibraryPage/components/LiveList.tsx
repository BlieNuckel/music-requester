import { useState } from "react";
import useLiveEvents from "@/hooks/useLiveEvents";
import type { LiveEventsFilter } from "@/hooks/useLiveEvents";
import Skeleton from "@/components/Skeleton";
import type { LiveEventSummary, LiveEventStatus } from "@/types";

const FILTERS: { id: LiveEventsFilter; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "going", label: "Going" },
  { id: "dismissed", label: "Dismissed" },
  { id: "past", label: "Past" },
];

const EMPTY_MESSAGES: Record<LiveEventsFilter, string> = {
  upcoming: "No upcoming dates for artists you follow",
  going: "You haven't marked any shows as going",
  dismissed: "Nothing dismissed",
  past: "No past shows recorded yet",
};

const STATUS_LABELS: Partial<Record<LiveEventStatus, string>> = {
  cancelled: "Cancelled",
  postponed: "Postponed",
  rescheduled: "Rescheduled",
};

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
};

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, DATE_FORMAT);
}

function headliner(event: LiveEventSummary): string {
  const lead = event.performers.find((performer) => performer.isHeadliner);
  return lead?.name ?? event.performers[0]?.name ?? event.name;
}

function placeOf(event: LiveEventSummary): string {
  return [event.venueName, event.venueCity, event.venueCountry]
    .filter(Boolean)
    .join(", ");
}

function LiveRow({
  event,
  isPast,
}: {
  event: LiveEventSummary;
  isPast: boolean;
}) {
  const statusLabel = STATUS_LABELS[event.status];

  return (
    <li className="flex items-start justify-between gap-4 bg-white dark:bg-gray-800 rounded-xl border-2 border-black shadow-cartoon-sm p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">
            {headliner(event)}
          </span>
          {statusLabel && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border-2 border-black bg-amber-300 text-black">
              {statusLabel}
            </span>
          )}
          {event.response === "going" && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border-2 border-black bg-emerald-300 text-black">
              Going
            </span>
          )}
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
          {[placeOf(event), formatDate(event.eventDate)]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {/* A show that already happened has nothing left to act on. */}
      {!isPast && event.ticketUrl && (
        <a
          href={event.ticketUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="shrink-0 text-sm font-semibold px-3 py-1.5 rounded-lg border-2 border-black bg-orange-400 text-black shadow-cartoon-sm"
        >
          Tickets
        </a>
      )}
    </li>
  );
}

export default function LiveList() {
  const [filter, setFilter] = useState<LiveEventsFilter>("upcoming");
  const { events, loading, error } = useLiveEvents(filter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={filter === option.id}
            onClick={() => setFilter(option.id)}
            className={`text-sm font-semibold px-3 py-1.5 rounded-lg border-2 border-black shadow-cartoon-sm transition-transform ${
              filter === option.id
                ? "bg-orange-400 text-black"
                : "bg-white dark:bg-gray-700 dark:text-gray-100"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Could not load live dates
        </p>
      )}

      {loading && (
        <div className="flex flex-col gap-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      )}

      {!loading && !error && events.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {EMPTY_MESSAGES[filter]}
        </p>
      )}

      {!loading && events.length > 0 && (
        <ul className="flex flex-col gap-2">
          {events.map((event) => (
            <LiveRow
              key={event.eventKey}
              event={event}
              isPast={filter === "past"}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
