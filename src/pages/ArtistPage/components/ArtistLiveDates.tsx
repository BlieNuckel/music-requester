import type { LiveEventSummary, LiveEventStatus } from "@/types";

interface ArtistLiveDatesProps {
  dates: LiveEventSummary[];
}

const STATUS_LABELS: Partial<Record<LiveEventStatus, string>> = {
  cancelled: "Cancelled",
  postponed: "Postponed",
  rescheduled: "Rescheduled",
};

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
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

export default function ArtistLiveDates({ dates }: ArtistLiveDatesProps) {
  if (dates.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="text-gray-500 dark:text-gray-400 text-sm font-semibold uppercase tracking-wide mb-3">
        Live dates
      </h2>

      <ul className="flex flex-col gap-2">
        {dates.map((event) => (
          <li
            key={event.eventKey}
            className="flex items-center justify-between gap-4 bg-white dark:bg-gray-800 rounded-xl border-2 border-black shadow-cartoon-sm px-3 py-2"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {formatDate(event.eventDate)}
                </span>
                {STATUS_LABELS[event.status] && (
                  <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border-2 border-black bg-amber-300 text-black">
                    {STATUS_LABELS[event.status]}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                {[event.venueName, event.venueCity, event.venueCountry]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            </div>

            {event.ticketUrl && (
              <a
                href={event.ticketUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-lg border-2 border-black bg-orange-400 text-black shadow-cartoon-sm hover:translate-y-[-1px] hover:shadow-cartoon-md active:translate-y-[1px] active:shadow-cartoon-pressed transition-all"
              >
                Tickets
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
