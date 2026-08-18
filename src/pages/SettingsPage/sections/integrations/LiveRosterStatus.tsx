import useLiveRoster from "@/hooks/useLiveRoster";

interface LiveRosterStatusProps {
  enabled: boolean;
}

export default function LiveRosterStatus({ enabled }: LiveRosterStatusProps) {
  const { roster } = useLiveRoster(enabled);
  if (!roster) return null;

  const total = roster.tracked + roster.pending + roster.unavailable;
  if (total === 0) return null;

  return (
    <div className="rounded-xl border-2 border-black shadow-cartoon-sm p-3 bg-white dark:bg-gray-800 space-y-1">
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        {roster.tracked} tracked, {roster.pending} pending, {roster.unavailable}{" "}
        unavailable
      </p>

      {roster.unavailable > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          JamBase has no listing for {roster.unavailable} followed{" "}
          {roster.unavailable === 1 ? "artist" : "artists"}, so no dates will
          ever appear for them. Nothing to fix: a confirmed miss is not retried,
          which is what keeps it from costing a call every sweep.
        </p>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500">
        Pending artists are looked up a batch per sweep, so a large roster takes
        a few days to settle.
      </p>
    </div>
  );
}
