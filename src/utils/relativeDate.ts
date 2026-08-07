const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Honest relative wording for a release date: "today", "yesterday",
 * "5 days ago", "3 weeks ago", "2 months ago". Returns null for missing
 * or unparseable dates and for dates in the future.
 */
export function formatRelativeReleaseDate(
  date: string | null,
  now: number = Date.now()
): string | null {
  if (!date) return null;
  const parsed = Date.parse(date);
  if (Number.isNaN(parsed) || parsed > now) return null;

  const days = Math.floor((now - parsed) / DAY_MS);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}
