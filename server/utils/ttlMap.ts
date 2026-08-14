type Entry<V> = { value: V; expiresAt: number };

export type TtlMap<K, V> = {
  /** The live value for `key`, or undefined when absent or expired. Expired entries are dropped on read. */
  get(key: K, now?: number): V | undefined;
  /** Store `value` under `key` for `ttlMs`, sweeping anything that has since expired. */
  set(key: K, value: V, ttlMs: number, now?: number): void;
  /** When `key` expires, or undefined when it is absent or already expired. */
  expiresAt(key: K, now?: number): number | undefined;
  /** Every key still live at `now`, in insertion order. */
  keys(now?: number): K[];
  delete(key: K): boolean;
  clear(): void;
  /** Live entry count, for tests and diagnostics. Counts expired-but-unswept entries. */
  size(): number;
};

/**
 * A Map whose entries expire. Unlike a plain Map guarded by a timestamp check at the
 * call site, an entry that is never read again is still evicted: every write sweeps
 * what has expired, so the map stays proportional to live keys rather than to every
 * key ever used.
 */
export function createTtlMap<K, V>(): TtlMap<K, V> {
  const entries = new Map<K, Entry<V>>();

  const sweep = (now: number) => {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(key);
    }
  };

  return {
    get(key, now = Date.now()) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value, ttlMs, now = Date.now()) {
      sweep(now);
      entries.set(key, { value, expiresAt: now + ttlMs });
    },
    expiresAt(key, now = Date.now()) {
      const entry = entries.get(key);
      if (!entry || entry.expiresAt <= now) return undefined;
      return entry.expiresAt;
    },
    keys(now = Date.now()) {
      sweep(now);
      return Array.from(entries.keys());
    },
    delete(key) {
      return entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}
