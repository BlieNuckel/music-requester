/**
 * Why one recommendation is what it is, as a record of the run that produced it.
 *
 * There used to be three of these, one per source, each hand-populated at the end of its own
 * pipeline and each a shadow of an execution that already knew everything they were
 * restating. This one is the execution: which nodes of the declared graph ran, in what order,
 * and what each of them had to say about its own turn. It renders on the same canvas the
 * settings page draws, because "what does this knob do" and "why this album" are the same
 * picture with different data on it.
 */

/** One named thing inside a fact that is a list. */
export type TraceItem = {
  name: string;
  /** A short qualifier: a weight, a share, the genres an artist carries. */
  detail?: string;
  /** The one the step went with. */
  chosen?: boolean;
};

/** One thing a node has to say about its own turn. */
export type TraceFact = {
  label: string;
  value?: string;
  items?: TraceItem[];
  /** How many `items` the cap left out, so a truncated list says that it is one. */
  more?: number;
};

/** What one node did on one run. */
export type NodeRun = {
  nodeId: string;
  ms: number;
  /** A short shape-of-the-output line; never the output itself. */
  summary: string;
  /**
   * Whether the node handed anything on. A node that ran and came up empty is a different
   * story from one that never ran at all, and only the first is visible in a list of turns.
   */
  produced: boolean;
  facts: TraceFact[];
};

export type RecommendationTrace = {
  /** The node whose output became this recommendation. */
  source: string;
  /** The turns this pick took, in the order they were taken. */
  nodes: NodeRun[];
  /** What the shared lookup allowance looked like once this pick was done with it. */
  budget: { label: string; remaining: number; of: number };
};

/** How many entries a fact lists before it starts counting the rest. */
export const TRACE_ITEM_LIMIT = 12;

/**
 * A fact's items, capped, with the overflow counted rather than dropped silently. A pick can
 * consider a hundred-odd neighbours, and five picks of those ship to the browser together.
 */
export function cappedItems(
  label: string,
  items: TraceItem[],
  limit: number = TRACE_ITEM_LIMIT
): TraceFact {
  const chosen = items.filter((item) => item.chosen);
  const rest = items.filter((item) => !item.chosen).slice(0, limit);
  const shown = [...chosen, ...rest];

  return {
    label,
    ...(items.length > shown.length
      ? { more: items.length - shown.length }
      : {}),
    items: shown,
  };
}
