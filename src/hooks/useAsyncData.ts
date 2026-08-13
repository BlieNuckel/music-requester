import { useState, useEffect, useRef, useCallback } from "react";

export type FetchContext = {
  key: string;
  refresh: boolean;
  /**
   * Aborted when the key changes, a refresh supersedes this run, or the component
   * unmounts. Pass it to `fetch` so the request actually stops instead of merely
   * having its result discarded.
   */
  signal: AbortSignal;
};

export type UseAsyncDataReturn<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setData: (updater: (prev: T) => T) => void;
};

type AsyncResult<T> = {
  key: string | null;
  nonce: number;
  data: T | null;
  error: string | null;
};

/**
 * Generic key-driven data fetching hook.
 *
 * - `key` identifies the request; changing it triggers a new fetch. Pass
 *   `null` to disable fetching (data/error are exposed as null).
 * - `loading` is derived from key/nonce mismatch, so no state is set
 *   synchronously in effects (react-hooks/set-state-in-effect compliant).
 * - Stale responses from superseded fetches are discarded, and the request behind
 *   them is aborted via the `signal` on the fetch context.
 * - On error the previous data is kept; `error` is masked while a newer
 *   fetch is in flight.
 * - `refresh()` refetches the current key and resolves when it settles;
 *   the fetcher receives `refresh: true` for that run.
 * - `setData` applies local mutations (e.g. optimistic list updates).
 */
export default function useAsyncData<T>(
  key: string | null,
  fetcher: (ctx: FetchContext) => Promise<T>
): UseAsyncDataReturn<T> {
  const [result, setResult] = useState<AsyncResult<T>>({
    key: null,
    nonce: 0,
    data: null,
    error: null,
  });
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  const refreshRequestedRef = useRef(false);
  const refreshResolversRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (key === null) {
      refreshResolversRef.current.splice(0).forEach((resolve) => resolve());
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const isRefresh = refreshRequestedRef.current;
    refreshRequestedRef.current = false;

    const run = async () => {
      try {
        const data = await fetcherRef.current({
          key,
          refresh: isRefresh,
          signal: controller.signal,
        });
        if (!cancelled) {
          setResult({ key, nonce, data, error: null });
        }
      } catch (err) {
        if (!cancelled) {
          setResult((prev) => ({
            key,
            nonce,
            data: prev.data,
            error: err instanceof Error ? err.message : "Request failed",
          }));
        }
      } finally {
        if (!cancelled) {
          refreshResolversRef.current.splice(0).forEach((resolve) => resolve());
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key, nonce]);

  const refresh = useCallback(() => {
    refreshRequestedRef.current = true;
    setNonce((n) => n + 1);
    return new Promise<void>((resolve) => {
      refreshResolversRef.current.push(resolve);
    });
  }, []);

  const setData = useCallback((updater: (prev: T) => T) => {
    setResult((prev) =>
      prev.data === null ? prev : { ...prev, data: updater(prev.data) }
    );
  }, []);

  const loading =
    key !== null && (result.key !== key || result.nonce !== nonce);

  return {
    data: key === null ? null : result.data,
    loading,
    error: key === null || loading ? null : result.error,
    refresh,
    setData,
  };
}
