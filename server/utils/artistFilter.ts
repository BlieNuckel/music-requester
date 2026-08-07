/**
 * MusicBrainz special-purpose artists — placeholders for "no single artist"
 * rather than something a user can have a taste for. Compilations credited to
 * them flood any recommendation surface that ranks by release count, so they
 * are filtered out of every candidate pool.
 * https://musicbrainz.org/doc/Style/Unknown_and_untitled/Special_purpose_artist
 */
export const VARIOUS_ARTISTS_MBID = "89ad4ac3-39f7-470e-963a-56509c546377";
export const UNKNOWN_ARTIST_MBID = "125ec42a-7229-4250-afc5-e057484327fe";
export const NO_ARTIST_MBID = "eec63d3c-3b81-4ad4-b1e4-7c147d4d2b61";

const PLACEHOLDER_MBIDS: ReadonlySet<string> = new Set([
  VARIOUS_ARTISTS_MBID,
  UNKNOWN_ARTIST_MBID,
  NO_ARTIST_MBID,
]);

/**
 * Bare "VA" is deliberately absent — it is a real artist name as often as it is
 * an abbreviation, and the dotted form covers the abbreviation case.
 */
const PLACEHOLDER_NAMES: ReadonlySet<string> = new Set([
  "various artists",
  "various",
  "v.a.",
  "[unknown]",
  "unknown artist",
  "[no artist]",
]);

/** True when this artist is a placeholder credit rather than a real artist. */
export function isPlaceholderArtist(
  name?: string | null,
  mbid?: string | null
): boolean {
  if (mbid && PLACEHOLDER_MBIDS.has(mbid.toLowerCase())) return true;
  if (!name) return false;
  return PLACEHOLDER_NAMES.has(name.trim().toLowerCase());
}

/** True when any credited artist MBID is a placeholder (multi-artist credits). */
export function hasPlaceholderArtist(mbids: readonly string[]): boolean {
  return mbids.some((mbid) => PLACEHOLDER_MBIDS.has(mbid.toLowerCase()));
}
