/**
 * Paced MusicBrainz lookups one carousel build may spend across all of its picks.
 *
 * A leaf module rather than a constant on the builder because the settings graph renders
 * this number to admins as fact, and importing the builder to read it would drag the whole
 * recommender into a page that only needs one integer.
 */
export const RESOLUTION_BUDGET = 30;

/** What the allowance is called wherever it is shown. */
export const RESOLUTION_BUDGET_LABEL = "MusicBrainz lookups per build";
