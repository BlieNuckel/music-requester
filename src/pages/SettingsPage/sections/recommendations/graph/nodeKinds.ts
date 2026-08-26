import { STRUCTURAL_KINDS } from "@shared/recommenderGraph";
import type { NodeKind } from "@shared/recommenderGraph";

/**
 * How a kind's badge is painted, on a card and in the legend that explains the cards. Tinted
 * only when reading the node as a plain step would read the chart wrong: every node says what
 * it is, and the three that are not a single pass are the ones worth catching the eye.
 */
export const kindBadgeClass = (kind: NodeKind): string =>
  `px-1.5 py-0.5 rounded text-[10px] font-bold ${
    STRUCTURAL_KINDS.includes(kind)
      ? "bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100"
      : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
  }`;
