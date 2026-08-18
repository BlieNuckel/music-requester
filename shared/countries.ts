/**
 * Codes and names for the country pickers, and the validation both the settings
 * route and the client run.
 */
export type Country = {
  code: string;
  name: string;
};

/** A pasted or typed list, split into what we recognised and what we did not. */
export type ParsedCountryCodes = {
  codes: string[];
  unknown: string[];
  /** Codes that were accepted under a different name, so the UI can say so. */
  aliased: { from: string; to: string }[];
};

/**
 * The 249 officially assigned ISO 3166-1 alpha-2 codes, which is what the events
 * API expects.
 *
 * Deliberately a fixed list rather than enumerated from `Intl.DisplayNames` at
 * runtime: ICU also resolves deprecated aliases (UK, AN, SU), macro-regions (EU,
 * QO, ZZ) and pseudo-locales (XA), so enumerating would offer codes the API
 * rejects, and the set would shift with the runtime's ICU version.
 */
const ISO_ALPHA2 = [
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ",
  "BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ",
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ",
  "DE DJ DK DM DO DZ",
  "EC EE EG EH ER ES ET",
  "FI FJ FK FM FO FR",
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY",
  "HK HM HN HR HT HU",
  "ID IE IL IM IN IO IQ IR IS IT",
  "JE JM JO JP",
  "KE KG KH KI KM KN KP KR KW KY KZ",
  "LA LB LC LI LK LR LS LT LU LV LY",
  "MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ",
  "NA NC NE NF NG NI NL NO NP NR NU NZ",
  "OM",
  "PA PE PF PG PH PK PL PM PN PR PS PT PW PY",
  "QA",
  "RE RO RS RU RW",
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ",
  "TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ",
  "UA UG UM US UY UZ",
  "VA VC VE VG VI VN VU",
  "WF WS",
  "YE YT",
  "ZA ZM ZW",
].join(" ");

export const COUNTRY_CODES: readonly string[] = ISO_ALPHA2.split(" ");

/**
 * Codes people reach for that ISO does not assign, and what to use instead. UK
 * is the one that actually happens: it is the internet's country code for the
 * United Kingdom, and the events API only knows GB.
 */
export const COUNTRY_CODE_ALIASES: Readonly<Record<string, string>> = {
  UK: "GB",
};

const CODE_SET = new Set(COUNTRY_CODES);

const SEPARATORS = /[,;\s]+/;

let regionNames: Intl.DisplayNames | null | undefined;
let sortedCountries: Country[] | null = null;

function getRegionNames(): Intl.DisplayNames | null {
  if (regionNames === undefined) {
    regionNames =
      typeof Intl.DisplayNames === "function"
        ? new Intl.DisplayNames(["en"], { type: "region", fallback: "code" })
        : null;
  }
  return regionNames;
}

/**
 * The English name for a code, falling back to the code itself. Only assigned
 * codes reach ICU: `of()` throws a RangeError on anything that is not a valid
 * region subtag, and a stored value can be junk like "SWE".
 */
export function countryName(code: string): string {
  const upper = code.trim().toUpperCase();
  if (!CODE_SET.has(upper)) return upper;
  return getRegionNames()?.of(upper) ?? upper;
}

/** Every country, sorted by name, for a picker's initial list. */
export function listCountries(): Country[] {
  if (!sortedCountries) {
    sortedCountries = COUNTRY_CODES.map((code) => ({
      code,
      name: countryName(code),
    })).sort((a, b) => a.name.localeCompare(b.name));
  }
  return sortedCountries;
}

/**
 * Split a typed or pasted list into recognised codes and leftovers. Accepts
 * commas, semicolons and whitespace, because "SE, DK" and "SE DK" are both what
 * someone means. Aliases resolve rather than being reported as unknown.
 */
export function parseCountryCodes(raw: string): ParsedCountryCodes {
  const codes: string[] = [];
  const unknown: string[] = [];
  const aliased: { from: string; to: string }[] = [];

  for (const part of raw.split(SEPARATORS)) {
    const token = part.trim().toUpperCase();
    if (token === "") continue;

    const resolved = COUNTRY_CODE_ALIASES[token] ?? token;
    if (!CODE_SET.has(resolved)) {
      unknown.push(token);
      continue;
    }
    if (resolved !== token) aliased.push({ from: token, to: resolved });
    if (!codes.includes(resolved)) codes.push(resolved);
  }

  return { codes, unknown, aliased };
}

/**
 * A single letter is not a code prefix worth ranking: "d" would put Algeria (DZ)
 * above Denmark. Code prefixes only outrank names once there is enough typed to
 * mean something.
 */
/**
 * Why a code cannot be used, as a sentence, or null when it is fine. Shared so
 * the settings route, the per-user preferences route and the picker all say the
 * same thing about the same input.
 */
export function countryCodeError(code: string): string | null {
  const upper = code.toUpperCase();

  const alias = COUNTRY_CODE_ALIASES[upper];
  if (alias) {
    return `Use ${alias} rather than ${upper} — that is what the events API expects.`;
  }
  if (!CODE_SET.has(upper)) {
    return `"${code}" is not a two-letter country code (ISO 3166-1 alpha-2).`;
  }
  // Stored as typed, and the events API only matches uppercase.
  if (code !== upper) {
    return `"${code}" must be uppercase: use ${upper}.`;
  }
  return null;
}

function matchRank(country: Country, query: string): number {
  if (country.code === query) return 0;
  if (query.length > 1 && country.code.startsWith(query)) return 1;

  const name = country.name.toUpperCase();
  if (name.startsWith(query)) return 2;
  return name.includes(query) ? 3 : -1;
}

/**
 * Countries matching a query by code or name, best match first, minus the ones
 * already chosen. An empty query lists everything still available, so opening the
 * picker is also a way to browse.
 */
export function searchCountries(
  query: string,
  chosen: readonly string[] = []
): Country[] {
  const taken = new Set(chosen.map((code) => code.toUpperCase()));
  const available = listCountries().filter(
    (country) => !taken.has(country.code)
  );

  const normalized = query.trim().toUpperCase();
  if (normalized === "") return available;

  return available
    .map((country) => ({ country, rank: matchRank(country, normalized) }))
    .filter((entry) => entry.rank >= 0)
    .sort(
      (a, b) => a.rank - b.rank || a.country.name.localeCompare(b.country.name)
    )
    .map((entry) => entry.country);
}
