import { renderHook, act, waitFor } from "@testing-library/react";
import useAsyncData from "../useAsyncData";
import type { FetchContext } from "../useAsyncData";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useAsyncData", () => {
  it("does not fetch when key is null", () => {
    const fetcher = vi.fn();
    const { result } = renderHook(() => useAsyncData(null, fetcher));

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("fetches on mount and exposes data", async () => {
    const fetcher = vi.fn().mockResolvedValue("value");
    const { result } = renderHook(() => useAsyncData("k1", fetcher));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBe("value");
    expect(result.current.error).toBeNull();
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ key: "k1", refresh: false })
    );
  });

  it("exposes error message on failure and keeps previous data", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockRejectedValueOnce(new Error("boom"));
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useAsyncData(key, fetcher),
      { initialProps: { key: "k1" } }
    );

    await waitFor(() => {
      expect(result.current.data).toBe("first");
    });

    rerender({ key: "k2" });

    await waitFor(() => {
      expect(result.current.error).toBe("boom");
    });

    expect(result.current.data).toBe("first");
    expect(result.current.loading).toBe(false);
  });

  it("uses fallback message for non-Error throws", async () => {
    const fetcher = vi.fn().mockRejectedValue("string failure");
    const { result } = renderHook(() => useAsyncData("k1", fetcher));

    await waitFor(() => {
      expect(result.current.error).toBe("Request failed");
    });
  });

  it("refetches when key changes and keeps stale data while loading", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useAsyncData(key, fetcher),
      { initialProps: { key: "k1" } }
    );

    await act(async () => {
      first.resolve("first");
      await first.promise;
    });
    expect(result.current.data).toBe("first");

    rerender({ key: "k2" });
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe("first");

    await act(async () => {
      second.resolve("second");
      await second.promise;
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe("second");
  });

  it("discards responses from superseded fetches", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useAsyncData(key, fetcher),
      { initialProps: { key: "k1" } }
    );

    rerender({ key: "k2" });

    await act(async () => {
      second.resolve("second");
      await second.promise;
    });
    await act(async () => {
      first.resolve("first");
      await first.promise;
    });

    expect(result.current.data).toBe("second");
    expect(result.current.loading).toBe(false);
  });

  it("masks stale error while a newer fetch is loading", async () => {
    const second = deferred<string>();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useAsyncData(key, fetcher),
      { initialProps: { key: "k1" } }
    );

    await waitFor(() => {
      expect(result.current.error).toBe("boom");
    });

    rerender({ key: "k2" });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it("refresh refetches with refresh: true and resolves when settled", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("refreshed");
    const { result } = renderHook(() => useAsyncData("k1", fetcher));

    await waitFor(() => {
      expect(result.current.data).toBe("first");
    });

    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refresh();
    });
    await act(async () => {
      await refreshPromise;
    });

    expect(result.current.data).toBe("refreshed");
    expect(result.current.loading).toBe(false);
    expect(fetcher).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: "k1", refresh: true })
    );
  });

  it("sets loading while refreshing and keeps existing data", async () => {
    const second = deferred<string>();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useAsyncData("k1", fetcher));

    await waitFor(() => {
      expect(result.current.data).toBe("first");
    });

    act(() => {
      void result.current.refresh();
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe("first");

    await act(async () => {
      second.resolve("refreshed");
      await second.promise;
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe("refreshed");
  });

  it("refresh resolves immediately when key is null", async () => {
    const fetcher = vi.fn();
    const { result } = renderHook(() => useAsyncData(null, fetcher));

    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refresh();
    });
    await act(async () => {
      await refreshPromise;
    });

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("setData applies local updates to loaded data", async () => {
    const fetcher = vi.fn().mockResolvedValue([1, 2, 3]);
    const { result } = renderHook(() => useAsyncData<number[]>("k1", fetcher));

    await waitFor(() => {
      expect(result.current.data).toEqual([1, 2, 3]);
    });

    act(() => {
      result.current.setData((prev) => prev.filter((n) => n !== 2));
    });

    expect(result.current.data).toEqual([1, 3]);
  });

  it("setData is a no-op before data has loaded", () => {
    const fetcher = vi.fn().mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAsyncData<number[]>("k1", fetcher));

    act(() => {
      result.current.setData((prev) => [...prev, 4]);
    });

    expect(result.current.data).toBeNull();
  });

  it("uses the latest fetcher when the key changes", async () => {
    const fetcherA = vi.fn((ctx: FetchContext) =>
      Promise.resolve(`A:${ctx.key}`)
    );
    const fetcherB = vi.fn((ctx: FetchContext) =>
      Promise.resolve(`B:${ctx.key}`)
    );

    const { result, rerender } = renderHook(
      ({ key, fetcher }: { key: string; fetcher: typeof fetcherA }) =>
        useAsyncData(key, fetcher),
      { initialProps: { key: "k1", fetcher: fetcherA } }
    );

    await waitFor(() => {
      expect(result.current.data).toBe("A:k1");
    });

    rerender({ key: "k2", fetcher: fetcherB });

    await waitFor(() => {
      expect(result.current.data).toBe("B:k2");
    });
    expect(fetcherB).toHaveBeenCalledWith(
      expect.objectContaining({ key: "k2", refresh: false })
    );
  });

  it("aborts the in-flight request when the key changes", async () => {
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn((ctx: FetchContext) => {
      signals.push(ctx.signal);
      return ctx.key === "k1"
        ? new Promise<string>(() => {})
        : Promise.resolve(ctx.key);
    });

    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useAsyncData(key, fetcher),
      { initialProps: { key: "k1" } }
    );

    expect(signals[0].aborted).toBe(false);

    rerender({ key: "k2" });

    await waitFor(() => {
      expect(result.current.data).toBe("k2");
    });
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it("aborts the in-flight request on unmount", async () => {
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn((ctx: FetchContext) => {
      signals.push(ctx.signal);
      return new Promise<string>(() => {});
    });

    const { unmount } = renderHook(() => useAsyncData("k1", fetcher));
    expect(signals[0].aborted).toBe(false);

    unmount();

    expect(signals[0].aborted).toBe(true);
  });

  it("does not surface an aborted request as an error", async () => {
    const first = deferred<string>();
    const fetcher = vi.fn((ctx: FetchContext) =>
      ctx.key === "k1" ? first.promise : Promise.resolve(ctx.key)
    );

    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useAsyncData(key, fetcher),
      { initialProps: { key: "k1" } }
    );

    rerender({ key: "k2" });
    await waitFor(() => {
      expect(result.current.data).toBe("k2");
    });

    // The abandoned request rejects the way an aborted fetch does.
    await act(async () => {
      first.reject(
        new DOMException("The operation was aborted.", "AbortError")
      );
      await Promise.resolve();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe("k2");
  });
});
