import { Link } from "react-router-dom";
import type { LiveEventStatus, LiveNotice } from "@/types";

interface LiveBannerProps {
  notice: LiveNotice;
  additionalCount: number;
  onRespond: (eventId: number, response: "going" | "dismissed") => void;
}

const STATUS_LABELS: Partial<Record<LiveEventStatus, string>> = {
  cancelled: "Cancelled",
  postponed: "Postponed",
  rescheduled: "Rescheduled",
};

const STATUS_CLASSES: Partial<Record<LiveEventStatus, string>> = {
  cancelled: "bg-red-500 text-white",
  postponed: "bg-amber-400 text-black",
  rescheduled: "bg-amber-400 text-black",
};

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
};

function headliner(notice: LiveNotice): string {
  const lead = notice.performers.find((performer) => performer.isHeadliner);
  return lead?.name ?? notice.performers[0]?.name ?? notice.name;
}

/** "near you" is wrong for a show in another country, so the tier picks the wording. */
function headline(notice: LiveNotice): string {
  const artist = headliner(notice);
  if (notice.status !== "scheduled") {
    return `${artist}: ${STATUS_LABELS[notice.status] ?? "Updated"}`;
  }
  return notice.tier === "local"
    ? `${artist} is playing near you`
    : `${artist} is playing within reach`;
}

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, DATE_FORMAT);
}

function formatPlace(notice: LiveNotice): string {
  const parts = [notice.venueName, notice.venueCity].filter(Boolean);
  if (notice.tier !== "local" && notice.venueCountry) {
    parts.push(notice.venueCountry);
  }
  return parts.join(", ");
}

function formatDistance(notice: LiveNotice): string | null {
  if (notice.tier !== "local" || notice.distanceKm === null) return null;
  return `${Math.round(notice.distanceKm)} km`;
}

export default function LiveBanner({
  notice,
  additionalCount,
  onRespond,
}: LiveBannerProps) {
  const distance = formatDistance(notice);
  const statusLabel = STATUS_LABELS[notice.status];

  return (
    <section
      aria-label="Live nearby"
      className="h-full bg-white dark:bg-gray-800 rounded-xl border-2 border-black shadow-cartoon-md p-4 flex flex-col sm:flex-row sm:items-center gap-3"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            aria-hidden="true"
            className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"
          />
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 truncate">
            {headline(notice)}
          </h2>
          {statusLabel && (
            <span
              className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border-2 border-black ${STATUS_CLASSES[notice.status]}`}
            >
              {statusLabel}
            </span>
          )}
        </div>

        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 truncate">
          {[formatPlace(notice), formatDate(notice.eventDate), distance]
            .filter(Boolean)
            .join(" · ")}
        </p>

        {notice.status === "rescheduled" && notice.previousStartDate && (
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">
            Moved from {formatDate(notice.previousStartDate)}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {additionalCount > 0 && (
          <Link
            to="/library/live"
            className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            {additionalCount} more →
          </Link>
        )}

        {notice.ticketUrl && (
          <a
            href={notice.ticketUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm font-semibold px-3 py-1.5 rounded-lg border-2 border-black bg-orange-400 text-black shadow-cartoon-sm hover:translate-y-[-1px] hover:shadow-cartoon-md active:translate-y-[1px] active:shadow-cartoon-pressed transition-all"
          >
            Tickets
          </a>
        )}

        <button
          type="button"
          onClick={() => onRespond(notice.id, "going")}
          className="text-sm font-semibold px-3 py-1.5 rounded-lg border-2 border-black bg-white dark:bg-gray-700 dark:text-gray-100 shadow-cartoon-sm hover:translate-y-[-1px] hover:shadow-cartoon-md active:translate-y-[1px] active:shadow-cartoon-pressed transition-all"
        >
          Going
        </button>

        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => onRespond(notice.id, "dismissed")}
          className="text-sm font-bold w-8 h-8 rounded-lg border-2 border-black bg-white dark:bg-gray-700 dark:text-gray-100 shadow-cartoon-sm hover:translate-y-[-1px] hover:shadow-cartoon-md active:translate-y-[1px] active:shadow-cartoon-pressed transition-all"
        >
          ✕
        </button>
      </div>
    </section>
  );
}
