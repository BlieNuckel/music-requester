function normalizeTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalized `artist::album` key. Callers join album lists that carry different
 * identifiers — Plex ids, MusicBrainz ids, Last.fm entries with no id at all —
 * so the only join between them is the text: lowercased, stripped of diacritics
 * and punctuation, whitespace collapsed. Deliberately conservative: an edition
 * suffix one source has and another doesn't simply fails to match, and a missed
 * match only means a duplicate survives, never that two different albums merge.
 */
export function normalizeAlbumKey(artist: string, title: string): string {
  return `${normalizeTitle(artist)}::${normalizeTitle(title)}`;
}
