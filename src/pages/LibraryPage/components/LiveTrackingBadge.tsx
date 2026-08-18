import type { LiveTrackingState } from "@/types";

interface LiveTrackingBadgeProps {
  state: LiveTrackingState;
}

const UNAVAILABLE_EXPLANATION =
  "Our live events source has no listing for this artist, so no tour dates will ever show up for them.";

/**
 * Only `unavailable` gets a badge. `tracked` is the expected case and marking
 * every row would be noise, and `pending` resolves itself within a few sweeps.
 */
export default function LiveTrackingBadge({ state }: LiveTrackingBadgeProps) {
  if (state !== "unavailable") return null;

  return (
    <span
      title={UNAVAILABLE_EXPLANATION}
      className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border-2 border-black bg-amber-300 text-black"
    >
      No live listings
    </span>
  );
}
