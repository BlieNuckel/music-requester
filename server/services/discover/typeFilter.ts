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
