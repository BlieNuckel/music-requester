import type { ParamKind } from "@shared/recommenderGraph";

/**
 * Kinds rendered as a bar. They are the ones that fill a card's width and print their own
 * value, so the layout has to give them a row rather than a slot in a line of text, and the
 * line beside them has nowhere to put a number the bar is already showing.
 */
export const BAR_KINDS: ReadonlySet<ParamKind> = new Set<ParamKind>([
  "ratio",
  "split",
]);
