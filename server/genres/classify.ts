import vocabulary from "./vocabulary.json" with { type: "json" };

/**
 * What a tag turned out to be. Only `genre` reaches the genre vector; the rest are kept as
 * data because each is a candidate input the recommender may want later, and because
 * discarding them would make "we have no genre for this artist" indistinguishable from
 * "we have nothing at all for this artist".
 */
export type TagClass = "genre" | "region" | "era" | "unknown";

export type ClassifiedTag = {
  /** The tag as it arrived, for tracing back to the source. */
  name: string;
  /**
   * What to call it from here on. For a genre this is the MusicBrainz spelling, which is
   * also what gets passed to `tag.getTopAlbums` — measured against Last.fm, every canonical
   * name in the profile's vector returns a full page, so canonicalizing does not narrow the
   * album pool. For everything else it is the folded form, which is enough to merge
   * `Belgium` with `belgian` without pretending we know a better name. A region resolves to
   * its country's name, so the demonym and the country are one thing.
   */
  canonical: string;
  class: TagClass;
};

/**
 * A tag carrying a year or a decade is a release date or a listing — `2024`, `best of 2011`,
 * `2010s`. The trailing `s?` is what catches the decade form, which is common enough on
 * Last.fm to matter and would otherwise land in `unknown`.
 */
const DATED = /\b(19|20)\d{2}s?\b/;

const genresByFold = new Map<string, string>();
for (const genre of vocabulary.genres) {
  const key = foldTag(genre);
  if (key && !genresByFold.has(key)) genresByFold.set(key, genre);
}

const regions = new Map(Object.entries(vocabulary.regions));

const aliases = new Map(Object.entries(vocabulary.aliases));

/**
 * Which vocabulary the profile was built against. Part of the profile's config hash, so a
 * regenerated vocabulary invalidates stored profiles — otherwise a rebuilt artifact would
 * change what the recommender means by a genre while every stored profile kept the old
 * reading forever, with nothing to trigger the rebuild.
 */
export const VOCABULARY_VERSION: string = vocabulary.version;

/**
 * Comparison key for a tag: case, punctuation and `&`/`and` differences all collapse, so
 * `Hip-Hop`, `hip hop` and `HIP HOP` are one thing. Deliberately *not* stemming — folding
 * any harder starts merging `post-rock` into `rock` and `nu-disco` into `disco`, which
 * destroys exactly the granularity album-level genres were added to gain.
 */
export function foldTag(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Resolve one tag against the vocabularies. Order matters and is deliberate: if MusicBrainz
 * calls something a genre then it is a genre, whatever else might also claim the word.
 *
 * The alias step is where `DnB` becomes `drum and bass` and `rap` becomes `hip hop`. Those
 * come from Wikidata rather than from a table we maintain, which means they include
 * taxonomic claims and not merely spellings — that is the intended trade: someone else
 * curates them, and they are wrong far less often than a list we would write ourselves.
 */
export function classifyTag(raw: string): ClassifiedTag {
  const key = foldTag(raw);
  if (!key) return { name: raw, canonical: "", class: "unknown" };

  const direct = genresByFold.get(key);
  if (direct) return { name: raw, canonical: direct, class: "genre" };

  const aliased = aliases.get(key);
  if (aliased) return { name: raw, canonical: aliased, class: "genre" };

  const region = regions.get(key);
  if (region) return { name: raw, canonical: region, class: "region" };
  if (DATED.test(key)) return { name: raw, canonical: key, class: "era" };

  return { name: raw, canonical: key, class: "unknown" };
}

/** Whether a tag is a genre — the only class the genre vector accepts. */
export const isGenreTag = (raw: string): boolean =>
  classifyTag(raw).class === "genre";
