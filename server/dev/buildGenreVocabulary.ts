import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { request } from "undici";

/**
 * Regenerates `server/genres/vocabulary.json` from MusicBrainz and Wikidata.
 *
 * Run with `pnpm genres:build`. The output is committed on purpose: Wikidata's SPARQL
 * endpoint rate-limits and returns 502s under perfectly ordinary load, the data changes on
 * a timescale of years, and a committed artifact puts a bad merge in a diff where someone
 * can see it. Nothing at runtime talks to either source.
 *
 * Neither source alone is enough. MusicBrainz has a curated genre list and *no* aliases at
 * all; Wikidata has the aliases (`DnB` → `drum and bass`) and a vocabulary loose enough that
 * it would happily call things genres that Last.fm has never heard of. So MusicBrainz decides
 * what counts as a genre and Wikidata decides what else to call it.
 */
type SparqlBinding = Record<string, { value: string } | undefined>;

type SparqlResponse = { results: { bindings: SparqlBinding[] } };

type Vocabulary = {
  version: string;
  generatedAt: string;
  /** MusicBrainz genre names, canonical spelling. */
  genres: string[];
  /** Folded alias → the MusicBrainz genre name it resolves to. */
  aliases: Record<string, string>;
  /** Folded country name or demonym → the country's canonical name. */
  regions: Record<string, string>;
};

const USER_AGENT =
  "tunearr/1.0 ( https://github.com/BlieNuckel/tunearr ) genre-vocabulary-builder";

const MB_GENRES_URL = "https://musicbrainz.org/ws/2/genre/all?fmt=txt";
const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";

/** Music genre (Q188451), following subclass chains so sub-genres come along. */
const GENRE_QUERY = `SELECT ?label ?alias WHERE {
  ?g wdt:P31/wdt:P279* wd:Q188451 .
  ?g rdfs:label ?label . FILTER(lang(?label)="en")
  OPTIONAL { ?g skos:altLabel ?alias . FILTER(lang(?alias)="en") }
}`;

/**
 * Countries (Q6256) with their demonyms. Labels and alt-labels are fetched separately
 * because asking for both alongside the demonym makes the cross-product big enough that
 * the endpoint gives up with a 502.
 */
const COUNTRY_DEMONYM_QUERY = `SELECT ?label ?demonym WHERE {
  ?c wdt:P31 wd:Q6256 .
  ?c rdfs:label ?label . FILTER(lang(?label)="en")
  OPTIONAL { ?c wdt:P1549 ?demonym . FILTER(lang(?demonym)="en") }
}`;

const COUNTRY_ALIAS_QUERY = `SELECT ?label ?alias WHERE {
  ?c wdt:P31 wd:Q6256 .
  ?c rdfs:label ?label . FILTER(lang(?label)="en")
  ?c skos:altLabel ?alias . FILTER(lang(?alias)="en")
}`;

const RETRIES = 4;

/**
 * Longest a country name or demonym can plausibly be. Wikidata alt-labels are open to
 * anyone and carry the usual sediment — phone codes, slang, and the occasional advertising
 * slogan someone pasted into a country entity. None of it is a word anyone tags music with,
 * but none of it belongs in a committed artifact either.
 */
const MAX_REGION_LENGTH = 40;

const isPlausibleRegion = (name: string): boolean =>
  name.length <= MAX_REGION_LENGTH &&
  !/\d/.test(name) &&
  /^[\p{L}][\p{L}\s'’.-]*$/u.test(name);

/**
 * Comparison key for a tag: case, punctuation and `&`/`and` differences all collapse.
 * Duplicated in `server/genres/classify.ts` rather than imported — this script writes the
 * artifact that module reads, and having the generator depend on the consumer inverts that.
 * The two must agree; `classify.test.ts` asserts the folding the artifact was built with.
 */
export function foldTag(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const sleep = (ms: number): Promise<void> =>
  new Promise((done) => setTimeout(done, ms));

async function fetchText(url: string): Promise<string> {
  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    const res = await request(url, { headers: { "user-agent": USER_AGENT } });
    if (res.statusCode === 200) return res.body.text();
    await res.body.dump();
    console.warn(`  ${res.statusCode} from ${url}, retrying`);
    await sleep(2000 * (attempt + 1));
  }
  throw new Error(`Gave up on ${url} after ${RETRIES} attempts`);
}

async function sparql(query: string): Promise<SparqlBinding[]> {
  const url = `${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(query)}`;
  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    const res = await request(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/sparql-results+json",
      },
    });
    if (res.statusCode === 200) {
      const body = (await res.body.json()) as SparqlResponse;
      return body.results.bindings;
    }
    await res.body.dump();
    console.warn(`  ${res.statusCode} from Wikidata, retrying`);
    await sleep(5000 * (attempt + 1));
  }
  throw new Error(`Gave up on Wikidata after ${RETRIES} attempts`);
}

const bindingValue = (row: SparqlBinding, key: string): string | undefined =>
  row[key]?.value;

/**
 * Aliases worth keeping: those resolving to exactly one MusicBrainz genre, and only where
 * the alias doesn't already fold to that genre's own name. An alias claimed by two genres
 * (Wikidata has `R&B` on both `rhythm and blues` and `contemporary R&B`) is dropped rather
 * than guessed at — a wrong merge is worse than a missed one.
 */
function buildAliases(
  rows: SparqlBinding[],
  genresByFold: Map<string, string>
): { aliases: Record<string, string>; ambiguous: number } {
  const claims = new Map<string, Set<string>>();
  for (const row of rows) {
    const label = bindingValue(row, "label");
    const alias = bindingValue(row, "alias");
    if (!label || !alias) continue;

    const canonical = genresByFold.get(foldTag(label));
    if (!canonical) continue;

    const key = foldTag(alias);
    if (!key) continue;
    const existing = claims.get(key);
    if (existing) existing.add(canonical);
    else claims.set(key, new Set([canonical]));
  }

  const aliases: Record<string, string> = {};
  let ambiguous = 0;
  for (const [key, canonicals] of claims) {
    if (canonicals.size > 1) {
      ambiguous += 1;
      continue;
    }
    const [canonical] = canonicals;
    if (key === foldTag(canonical)) continue;
    if (genresByFold.has(key)) continue;
    aliases[key] = canonical;
  }
  return { aliases, ambiguous };
}

/**
 * Every country name, demonym and alt-label pointing at the country's canonical name, so
 * `Belgium` and `belgian` end up as one thing rather than two tags of half the weight.
 * Alt-labels arrive from a second query and carry no demonym, so they resolve by folding
 * onto a name the first query already established.
 *
 * A word MusicBrainz calls a genre is left out entirely — "if MusicBrainz calls it a genre,
 * it is one" is the rule the classifier applies, and the artifact must not contradict it.
 */
function buildRegions(
  demonymRows: SparqlBinding[],
  aliasRows: SparqlBinding[],
  genresByFold: Map<string, string>
): Record<string, string> {
  const regions: Record<string, string> = {};
  const add = (name: string, canonical: string): void => {
    const key = foldTag(name);
    if (!key || !isPlausibleRegion(name)) return;
    if (genresByFold.has(key)) return;
    regions[key] ??= canonical;

    // Wikidata writes acronyms with separators — the United States has "U. S. A." and no
    // plain "USA", which is the single most common country tag in music. A key whose every
    // token is one character is such an acronym, so register the run-together form too.
    const joined = key.split(" ").join("");
    if (key.split(" ").every((token) => token.length === 1) && joined !== key) {
      if (!genresByFold.has(joined)) regions[joined] ??= canonical;
    }
  };

  const countryByFold = new Map<string, string>();
  for (const row of demonymRows) {
    const label = bindingValue(row, "label");
    if (!label || !isPlausibleRegion(label)) continue;
    countryByFold.set(foldTag(label), label);
    add(label, label);
    const demonym = bindingValue(row, "demonym");
    if (demonym) add(demonym, label);
  }

  for (const row of aliasRows) {
    const alias = bindingValue(row, "alias");
    const label = bindingValue(row, "label");
    if (!alias || !label) continue;
    // An alt-label resolves to its own country's name, so `USA` and `Murica` both land on
    // "United States" rather than on themselves.
    add(alias, countryByFold.get(foldTag(label)) ?? label);
  }
  return regions;
}

async function main(): Promise<void> {
  console.log("Fetching MusicBrainz genres…");
  const genres = (await fetchText(MB_GENRES_URL))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
  console.log(`  ${genres.length} genres`);

  const genresByFold = new Map<string, string>();
  for (const genre of genres) {
    const key = foldTag(genre);
    if (key && !genresByFold.has(key)) genresByFold.set(key, genre);
  }

  console.log("Querying Wikidata for genre aliases…");
  const { aliases, ambiguous } = buildAliases(
    await sparql(GENRE_QUERY),
    genresByFold
  );
  console.log(
    `  ${Object.keys(aliases).length} aliases kept, ${ambiguous} ambiguous dropped`
  );

  console.log("Querying Wikidata for countries and demonyms…");
  const demonymRows = await sparql(COUNTRY_DEMONYM_QUERY);
  const aliasRows = await sparql(COUNTRY_ALIAS_QUERY);
  const regions = buildRegions(demonymRows, aliasRows, genresByFold);
  console.log(`  ${Object.keys(regions).length} country names and demonyms`);

  const generatedAt = new Date().toISOString();
  const vocabulary: Vocabulary = {
    version: generatedAt.slice(0, 10),
    generatedAt,
    genres,
    aliases,
    regions,
  };

  const out = resolve(import.meta.dirname, "../genres/vocabulary.json");
  writeFileSync(out, `${JSON.stringify(vocabulary, null, 0)}\n`);
  console.log(`Wrote ${out}`);
}

void main();
