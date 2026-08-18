import type { ProfileDebugSignal, ProfileDebugRecentSignal } from "@/types";

interface ProfileSignalTableProps {
  signals: ProfileDebugSignal[];
  recent: ProfileDebugRecentSignal[];
}

function formatStamp(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
}

export default function ProfileSignalTable({
  signals,
  recent,
}: ProfileSignalTableProps) {
  if (signals.length === 0) {
    return (
      <p className="text-xs text-gray-400 dark:text-gray-500">
        No signals recorded yet. The ingestion poller writes the first ones once
        this user has a Plex token and has played something.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        {signals.map((signal) => (
          <li
            key={signal.kind}
            className="flex flex-wrap items-baseline gap-x-2 text-xs"
          >
            <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">
              {signal.kind}
            </span>
            <span className="text-gray-600 dark:text-gray-400">
              {signal.count} {signal.count === 1 ? "event" : "events"}
            </span>
            <span className="text-gray-400 dark:text-gray-500">
              first {formatStamp(signal.firstAt)}, last{" "}
              {formatStamp(signal.lastAt)}
            </span>
          </li>
        ))}
      </ul>

      <div>
        <p className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
          Most recent writes
        </p>
        <ul className="space-y-0.5">
          {recent.map((event, index) => (
            <li
              key={`${event.kind}-${event.recordedAt}-${index}`}
              className="text-xs text-gray-600 dark:text-gray-400"
            >
              <span className="font-mono">{event.kind}</span> ·{" "}
              {formatStamp(event.recordedAt)} ·{" "}
              {/* A delta of nothing is the interesting case: the poller ran and found no change. */}
              {event.changed === 0
                ? "no items"
                : `${event.changed} ${event.changed === 1 ? "item" : "items"}`}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
