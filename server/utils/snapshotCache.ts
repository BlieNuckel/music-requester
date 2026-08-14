type Entry<T> = { value: T; expiresAt: number };

export type SnapshotCache<T> = {
  /** The cached snapshot, loading it first when absent or expired. */
  get(now?: number): Promise<T>;
  /** Reload regardless of freshness and repopulate, joining a load already in flight. */
  refresh(now?: number): Promise<T>;
  invalidate(): void;
};

/**
 * A single-value cache over one expensive fetch. Concurrent callers that arrive
 * during a load share it rather than each firing their own, and a rejected load
 * is never stored, so the next caller retries instead of inheriting a failure
 * for the rest of the TTL. `shouldCache` covers loaders that signal failure in
 * the resolved value instead of throwing.
 */
export function createSnapshotCache<T>(options: {
  load: () => Promise<T>;
  ttlMs: number | (() => number);
  shouldCache?: (value: T) => boolean;
}): SnapshotCache<T> {
  const { load, ttlMs, shouldCache } = options;

  let entry: Entry<T> | null = null;
  let inFlight: Promise<T> | null = null;

  const resolveTtl = () => (typeof ttlMs === "function" ? ttlMs() : ttlMs);

  const reload = (now: number): Promise<T> => {
    if (!inFlight) {
      inFlight = load()
        .then((value) => {
          if (!shouldCache || shouldCache(value)) {
            entry = { value, expiresAt: now + resolveTtl() };
          }
          return value;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };

  return {
    get(now = Date.now()) {
      if (entry && entry.expiresAt > now) return Promise.resolve(entry.value);
      return reload(now);
    },
    refresh(now = Date.now()) {
      return reload(now);
    },
    invalidate() {
      entry = null;
    },
  };
}
