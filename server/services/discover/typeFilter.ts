/**
 * Release-type noise filter (design doc decision 3). Data-driven so it can
 * become user-configurable later; applied at read time so stored rows are
 * never lost to a filter change.
 */
export const ALLOWED_PRIMARY_TYPES: ReadonlySet<string> = new Set([
  "Album",
  "EP",
  "Single",
]);

export const ALLOWED_SECONDARY_TYPES: ReadonlySet<string> = new Set([
  "Soundtrack",
  "Mixtape/Street",
]);

/**
 * Unknown types (NULL) pass through — honest pass-through beats guessing.
 * Known primary types outside the allowlist and any non-allowed secondary
 * type (live, remix, compilation, …) are blocked.
 */
export function isAllowedReleaseType(
  primaryType: string | null,
  secondaryTypes: string[] | null
): boolean {
  if (primaryType !== null && !ALLOWED_PRIMARY_TYPES.has(primaryType)) {
    return false;
  }
  if (secondaryTypes === null) return true;
  return secondaryTypes.every((t) => ALLOWED_SECONDARY_TYPES.has(t));
}

/**
 * A release group worth recommending: identified, dated, and not a live/remix/compilation
 * package. The three sources used to answer this two different ways — explore took
 * `primary-type === "Album"` only, while the personal and tag paths took the type filter —
 * so the same artist could yield a record from one source and nothing from another.
 */
export function isRecommendableRelease(release: {
  id?: string;
  "first-release-date"?: string;
  "primary-type"?: string | null;
  "secondary-types"?: string[] | null;
}): boolean {
  if (!release.id || !release["first-release-date"]) return false;
  return isAllowedReleaseType(
    release["primary-type"] ?? null,
    release["secondary-types"] ?? null
  );
}
