import {
  getFreshReleases,
  MAX_FRESH_RELEASES_DAYS,
} from "../../api/listenbrainz/freshReleases";
import type { ListenBrainzFreshRelease } from "../../api/listenbrainz/types";
import { createLogger } from "../../logger";

type CacheEntry = {
  fetchedAt: number;
  releases: ListenBrainzFreshRelease[];
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const log = createLogger("discover-feed");

let cache: CacheEntry | null = null;
let inFlight: Promise<ListenBrainzFreshRelease[]> | null = null;

/**
 * The sitewide fresh-releases feed, cached globally for 6h (aligned with the
 * followed poller). Failed fetches are not cached so the next request retries.
 */
export async function getCachedFreshReleases(
  now: number = Date.now()
): Promise<ListenBrainzFreshRelease[]> {
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.releases;
  }

  if (!inFlight) {
    inFlight = fetchAndCache(now);
  }
  return inFlight;
}

async function fetchAndCache(now: number): Promise<ListenBrainzFreshRelease[]> {
  try {
    const releases = await getFreshReleases(MAX_FRESH_RELEASES_DAYS);
    if (releases.length > 0) {
      cache = { fetchedAt: now, releases };
      log.info(`Fresh-releases feed cached (${releases.length} releases)`);
    } else {
      log.warn("Fresh-releases feed returned no releases; not caching");
    }
    return releases;
  } finally {
    inFlight = null;
  }
}

export function clearFreshReleasesCache(): void {
  cache = null;
  inFlight = null;
}
