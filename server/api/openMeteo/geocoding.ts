import NodeCache from "node-cache";
import { withCache } from "../../cache";
import { resilientFetch } from "../resilientFetch";
import { createLogger } from "../../logger";
import type {
  GeocodedPlace,
  OpenMeteoGeocodingResponse,
  OpenMeteoGeocodingResult,
} from "./types";

const log = createLogger("OpenMeteo Geocoding");

/**
 * Open-Meteo's geocoding index (GeoNames data). No key, no attribution
 * requirement, and no account to lose: the only thing sent is a place name.
 */
const GEOCODING_BASE = "https://geocoding-api.open-meteo.com/v1";

/** A city does not move, so a day is a conservative TTL. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_LIMIT = 5;

/** Enough to be a place name rather than a prefix sweep of the whole index. */
const MIN_QUERY_LENGTH = 2;

function toPlace(result: OpenMeteoGeocodingResult): GeocodedPlace | null {
  if (
    !result.name ||
    typeof result.latitude !== "number" ||
    typeof result.longitude !== "number"
  ) {
    return null;
  }

  return {
    name: result.name,
    region: result.admin1 ?? null,
    country: result.country ?? "",
    countryCode: result.country_code ?? "",
    latitude: result.latitude,
    longitude: result.longitude,
    population: result.population ?? null,
  };
}

async function fetchPlaces(
  query: string,
  limit: number
): Promise<GeocodedPlace[]> {
  const params = new URLSearchParams({
    name: query,
    count: String(limit),
    language: "en",
    format: "json",
  });

  try {
    const response = await resilientFetch(
      `${GEOCODING_BASE}/search?${params.toString()}`
    );
    if (!response.ok) {
      log.warn(`Geocoding lookup for "${query}" returned ${response.status}`);
      return [];
    }

    const data = (await response.json()) as OpenMeteoGeocodingResponse;
    // No matches comes back as a body with no `results` key at all.
    return (data.results ?? [])
      .map(toPlace)
      .filter((place): place is GeocodedPlace => place !== null);
  } catch (error) {
    log.error(`Geocoding lookup for "${query}" failed`, error);
    return [];
  }
}

const cachedFetchPlaces = withCache(fetchPlaces, {
  cache: new NodeCache(),
  key: (query, limit) => `${query.toLowerCase()}:${limit}`,
  ttlMs: CACHE_TTL_MS,
  label: "openmeteo-geocoding",
});

/**
 * Look up coordinates for a place name. Best-effort: a failure is an empty list,
 * because this only ever fills in a field the admin can also type by hand.
 */
export async function searchPlaces(
  query: string,
  limit = DEFAULT_LIMIT
): Promise<GeocodedPlace[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];
  return cachedFetchPlaces(trimmed, limit);
}
