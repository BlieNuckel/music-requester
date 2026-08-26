type HelpTipProps = { label: string; text: string };

/**
 * The paragraph explaining a knob, reachable from the knob itself.
 *
 * A native `title` rather than a rendered panel: a card sits inside a pan-and-zoom canvas
 * among absolutely positioned siblings, where anything drawn outside a card's own box is
 * either clipped by it or painted under the next node along. The browser's own tooltip has
 * neither problem, and stays legible when the canvas is zoomed out. The same text is a
 * visible paragraph in the list view, which is the view that exists for reading rather than
 * for pointing.
 */
export default function HelpTip({ label, text }: HelpTipProps) {
  return (
    <span
      tabIndex={0}
      role="note"
      aria-label={`${label}: ${text}`}
      title={text}
      className="nodrag inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-gray-400 text-[9px] font-bold leading-none text-gray-500 hover:border-amber-500 hover:text-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-400 dark:border-gray-500 dark:text-gray-400"
    >
      ?
    </span>
  );
}
