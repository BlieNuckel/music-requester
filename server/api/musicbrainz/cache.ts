import NodeCache from "node-cache";
import type { MbPriority } from "./queue";

/** How long a MusicBrainz value stays fresh, chosen by how volatile the data is. */
export const MB_TTL = {
  /** Facts about one MBID that effectively never change: titles, dates, labels, tracks. */
  immutable: 30 * 24 * 60 * 60,
  /** Entities that get corrected now and then, but don't gain content. */
  slow: 7 * 24 * 60 * 60,
  /** Anything that grows when an artist releases something: searches, discographies. */
  volatile: 6 * 60 * 60,
} as const;

/**
 * Past its TTL a "revalidate" entry is still served while a refresh runs, but
 * only for this long. After that the value is dropped and a caller waits.
 */
const STALE_GRACE_SECONDS = 7 * 24 * 60 * 60;

type CacheEntry<T> = { value: T; freshUntil: number };

/**
 * "expire" drops the value at its TTL. "revalidate" keeps serving the stale
 * value and refreshes it on the background lane, so a user never waits on data
 * we already have.
 */
type MbCacheStrategy = "expire" | "revalidate";

type MbCacheOptions = {
  key: string;
  ttlSeconds: number;
  priority?: MbPriority;
  strategy?: MbCacheStrategy;
};

type MbLoader<T> = (priority: MbPriority) => Promise<T>;

const cache = new NodeCache();

const inFlight = new Map<string, Promise<unknown>>();

function store<T>(
  key: string,
  value: T,
  ttlSeconds: number,
  strategy: MbCacheStrategy
): void {
  const hardTtl =
    strategy === "revalidate" ? ttlSeconds + STALE_GRACE_SECONDS : ttlSeconds;
  const entry: CacheEntry<T> = {
    value,
    freshUntil: Date.now() + ttlSeconds * 1000,
  };
  cache.set(key, entry, hardTtl);
}

/**
 * Run the loader unless an identical load is already running, in which case both
 * callers share its result. Deduping here rather than at the queue means a burst
 * of identical requests spends one MusicBrainz slot, not one each.
 */
function loadOnce<T>(
  options: MbCacheOptions,
  priority: MbPriority,
  loader: MbLoader<T>
): Promise<T> {
  const existing = inFlight.get(options.key);
  if (existing) return existing as Promise<T>;

  const promise = loader(priority)
    .then((value) => {
      store(
        options.key,
        value,
        options.ttlSeconds,
        options.strategy ?? "expire"
      );
      return value;
    })
    .finally(() => {
      inFlight.delete(options.key);
    });

  inFlight.set(options.key, promise);
  return promise;
}

/**
 * Serve a MusicBrainz value from cache, loading it through the request queue on
 * a miss. Rejections are never cached, so a throttled MusicBrainz can't leave a
 * failure sitting in the cache for the whole TTL.
 */
export function mbCached<T>(
  options: MbCacheOptions,
  loader: MbLoader<T>
): Promise<T> {
  const entry = cache.get<CacheEntry<T>>(options.key);

  if (entry === undefined) {
    return loadOnce(options, options.priority ?? "interactive", loader);
  }

  if (options.strategy === "revalidate" && entry.freshUntil <= Date.now()) {
    void loadOnce(options, "background", loader).catch(() => {
      // The stale value is still being served, so a failed refresh changes nothing.
    });
  }

  return Promise.resolve(entry.value);
}

/** Drop every cached MusicBrainz value. */
export function clearMbCache(): void {
  cache.flushAll();
  inFlight.clear();
}

/** Cached entry count and in-flight load count, for diagnostics. */
export function getMbCacheStats(): { entries: number; inFlight: number } {
  return { entries: cache.keys().length, inFlight: inFlight.size };
}
