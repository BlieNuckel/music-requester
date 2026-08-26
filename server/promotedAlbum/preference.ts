import type { LibraryPreference } from "../config";
import type { TraceSelectionReason } from "./types";

/** Which candidate artists a `libraryPreference` favours, and how each outcome is traced. */
export type PreferenceRule = {
  isPreferred: (artistMbid: string) => boolean;
  preferredReason: TraceSelectionReason;
  fallbackReason: TraceSelectionReason;
};

export function preferenceRule(
  libraryPreference: LibraryPreference,
  artistInLibrary: (mbid: string) => boolean
): PreferenceRule {
  switch (libraryPreference) {
    case "prefer_new":
      return {
        isPreferred: (mbid) => !artistInLibrary(mbid),
        preferredReason: "preferred_non_library",
        fallbackReason: "fallback_in_library",
      };
    case "prefer_library":
      return {
        isPreferred: (mbid) => artistInLibrary(mbid),
        preferredReason: "preferred_library",
        fallbackReason: "fallback_non_library",
      };
    case "no_preference":
      return {
        isPreferred: () => true,
        preferredReason: "no_preference",
        fallbackReason: "no_preference",
      };
  }
}

/**
 * The preferred side of the library line, or the whole set when that side is empty.
 *
 * Filtering before the draw is what makes the line load-bearing: ordering a draw by
 * preference cannot help when the draw itself never surfaced an unowned artist, and for a
 * user who owns most of their graph every draw comes back owned, so "adjacent to your taste
 * and you do not have it" quietly stops happening.
 *
 * Relaxing rather than emptying is deliberate, and the caller is told so it can say so: a
 * recommendation the user already owns beats no recommendation.
 */
export function preferredOrRelaxed<T>(
  items: T[],
  artistMbidOf: (item: T) => string,
  rule: PreferenceRule
): { items: T[]; relaxed: boolean } {
  const preferred = items.filter((item) =>
    rule.isPreferred(artistMbidOf(item))
  );
  return preferred.length > 0
    ? { items: preferred, relaxed: false }
    : { items, relaxed: true };
}

/**
 * Preferred candidates first, the rest after — the walk can then stop at its first hit.
 *
 * The same rule as {@link preferredOrRelaxed}, expressed over a walk instead of a draw: a
 * walk that stops at its first qualifying candidate only ever reaches the unpreferred ones
 * when no preferred one qualified, which is what relaxing means. It stays a walk here
 * because the tag path cannot tell a candidate apart until it has resolved it, and resolving
 * the whole pool to filter it is the thing the budget exists to prevent.
 */
export function orderByPreference<T>(
  items: T[],
  artistMbidOf: (item: T) => string,
  rule: PreferenceRule
): T[] {
  return [
    ...items.filter((item) => rule.isPreferred(artistMbidOf(item))),
    ...items.filter((item) => !rule.isPreferred(artistMbidOf(item))),
  ];
}
