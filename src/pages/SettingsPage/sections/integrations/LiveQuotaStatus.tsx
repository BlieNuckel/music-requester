import useLiveQuota from "@/hooks/useLiveQuota";

interface LiveQuotaStatusProps {
  enabled: boolean;
}

export default function LiveQuotaStatus({ enabled }: LiveQuotaStatusProps) {
  const { quota } = useLiveQuota(enabled);
  if (!quota) return null;

  const percent = Math.round(quota.ratio * 100);

  return (
    <div className="rounded-xl border-2 border-black shadow-cartoon-sm p-3 bg-white dark:bg-gray-800 space-y-1">
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        {quota.used} of {quota.quota} calls used this period ({percent}%)
      </p>

      {quota.hardStopped && (
        <p className="text-sm font-semibold text-rose-500">
          Lookups are paused until the period resets.
        </p>
      )}

      <p className="text-xs text-gray-500 dark:text-gray-400">
        At the current roster this projects to about {quota.projectedMonthly}{" "}
        calls a month. Roughly {quota.remainingFollowCapacity} more artists fit
        before the allowance is crossed, in steps of {quota.batchSize}.
      </p>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        Estimated from our own count. JamBase does not report usage in its
        responses, so its dashboard is the authority.
      </p>
    </div>
  );
}
