import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mbCached, clearMbCache, getMbCacheStats, MB_TTL } from "./cache";
import type { MbPriority } from "./queue";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  clearMbCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("mbCached", () => {
  it("loads on a miss and serves the cached value afterwards", async () => {
    const loader = vi.fn().mockResolvedValue("value");
    const options = { key: "k", ttlSeconds: MB_TTL.immutable };

    expect(await mbCached(options, loader)).toBe("value");
    expect(await mbCached(options, loader)).toBe("value");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("caches null as a real answer", async () => {
    const loader = vi.fn().mockResolvedValue(null);
    const options = { key: "k", ttlSeconds: MB_TTL.immutable };

    expect(await mbCached(options, loader)).toBeNull();
    expect(await mbCached(options, loader)).toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("never caches a rejection", async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValue("value");
    const options = { key: "k", ttlSeconds: MB_TTL.immutable };

    await expect(mbCached(options, loader)).rejects.toThrow("503");
    expect(await mbCached(options, loader)).toBe("value");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent loads of the same key into one", async () => {
    const gate = deferred<string>();
    const loader = vi.fn().mockReturnValue(gate.promise);
    const options = { key: "k", ttlSeconds: MB_TTL.immutable };

    const all = Promise.all([
      mbCached(options, loader),
      mbCached(options, loader),
      mbCached(options, loader),
    ]);
    gate.resolve("value");

    expect(await all).toEqual(["value", "value", "value"]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not collapse loads of different keys", async () => {
    const loader = vi.fn().mockResolvedValue("value");
    await Promise.all([
      mbCached({ key: "a", ttlSeconds: MB_TTL.immutable }, loader),
      mbCached({ key: "b", ttlSeconds: MB_TTL.immutable }, loader),
    ]);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("passes the requested lane to the loader", async () => {
    const loader = vi.fn().mockResolvedValue("value");
    await mbCached(
      { key: "k", ttlSeconds: MB_TTL.immutable, priority: "background" },
      loader
    );
    expect(loader).toHaveBeenCalledWith("background");
  });

  it("defaults to the interactive lane", async () => {
    const loader = vi.fn().mockResolvedValue("value");
    await mbCached({ key: "k", ttlSeconds: MB_TTL.immutable }, loader);
    expect(loader).toHaveBeenCalledWith("interactive");
  });

  it("reports entry and in-flight counts", async () => {
    const gate = deferred<string>();
    const pending = mbCached(
      { key: "k", ttlSeconds: MB_TTL.immutable },
      () => gate.promise
    );

    expect(getMbCacheStats()).toEqual({ entries: 0, inFlight: 1 });

    gate.resolve("value");
    await pending;

    expect(getMbCacheStats()).toEqual({ entries: 1, inFlight: 0 });
  });
});

describe("revalidate strategy", () => {
  const options = {
    key: "k",
    ttlSeconds: 60,
    strategy: "revalidate" as const,
  };

  it("serves a stale value immediately and refreshes behind it", async () => {
    vi.useFakeTimers();
    const loader = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValue("second");

    expect(await mbCached(options, loader)).toBe("first");

    vi.advanceTimersByTime(61_000);

    expect(await mbCached(options, loader)).toBe("first");
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    expect(await mbCached(options, loader)).toBe("second");
  });

  it("refreshes on the background lane so it cannot delay a search", async () => {
    vi.useFakeTimers();
    const lanes: MbPriority[] = [];
    const loader = vi.fn((priority: MbPriority) => {
      lanes.push(priority);
      return Promise.resolve("value");
    });

    await mbCached(options, loader);
    vi.advanceTimersByTime(61_000);
    await mbCached(options, loader);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));

    expect(lanes).toEqual(["interactive", "background"]);
  });

  it("keeps serving the stale value when the refresh fails", async () => {
    vi.useFakeTimers();
    const loader = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockRejectedValue(new Error("503"));

    await mbCached(options, loader);
    vi.advanceTimersByTime(61_000);

    expect(await mbCached(options, loader)).toBe("first");
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    expect(await mbCached(options, loader)).toBe("first");
  });

  it("does not refresh while the value is still fresh", async () => {
    vi.useFakeTimers();
    const loader = vi.fn().mockResolvedValue("value");

    await mbCached(options, loader);
    vi.advanceTimersByTime(59_000);
    await mbCached(options, loader);

    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe("clearMbCache", () => {
  it("drops cached values", async () => {
    const loader = vi.fn().mockResolvedValue("value");
    const options = { key: "k", ttlSeconds: MB_TTL.immutable };

    await mbCached(options, loader);
    clearMbCache();
    await mbCached(options, loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });
});
