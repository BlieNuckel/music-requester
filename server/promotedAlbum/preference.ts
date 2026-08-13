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

/** Preferred candidates first, the rest after — the walk can then stop at its first hit. */
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
