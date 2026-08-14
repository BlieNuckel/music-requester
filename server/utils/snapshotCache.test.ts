import { describe, it, expect, vi } from "vitest";
import { createSnapshotCache } from "./snapshotCache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createSnapshotCache", () => {
  it("loads once and serves the cached value inside the ttl", async () => {
    const load = vi.fn().mockResolvedValue("snapshot");
    const cache = createSnapshotCache({ load, ttlMs: 1000 });

    expect(await cache.get(0)).toBe("snapshot");
    expect(await cache.get(999)).toBe("snapshot");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads once the ttl elapses", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValue("second");
    const cache = createSnapshotCache({ load, ttlMs: 1000 });

    await cache.get(0);

    expect(await cache.get(1000)).toBe("second");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one load between callers that arrive together", async () => {
    const gate = deferred<string>();
    const load = vi.fn().mockReturnValue(gate.promise);
    const cache = createSnapshotCache({ load, ttlMs: 1000 });

    const both = Promise.all([cache.get(0), cache.get(0)]);
    gate.resolve("snapshot");

    expect(await both).toEqual(["snapshot", "snapshot"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not cache a rejected load", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("lidarr down"))
      .mockResolvedValue("snapshot");
    const cache = createSnapshotCache({ load, ttlMs: 1000 });

    await expect(cache.get(0)).rejects.toThrow("lidarr down");

    expect(await cache.get(0)).toBe("snapshot");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not cache a value shouldCache rejects", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue({ ok: true });
    const cache = createSnapshotCache({
      load,
      ttlMs: 1000,
      shouldCache: (value: { ok: boolean }) => value.ok,
    });

    await cache.get(0);

    expect(await cache.get(0)).toEqual({ ok: true });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("refresh reloads a still-fresh entry and repopulates it", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValue("second");
    const cache = createSnapshotCache({ load, ttlMs: 1000 });

    await cache.get(0);
    expect(await cache.refresh(10)).toBe("second");

    expect(await cache.get(500)).toBe("second");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("refresh joins a load already in flight instead of starting another", async () => {
    const gate = deferred<string>();
    const load = vi.fn().mockReturnValue(gate.promise);
    const cache = createSnapshotCache({ load, ttlMs: 1000 });

    const both = Promise.all([cache.get(0), cache.refresh(0)]);
    gate.resolve("snapshot");

    expect(await both).toEqual(["snapshot", "snapshot"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("invalidate forces the next get to reload", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValue("second");
    const cache = createSnapshotCache({ load, ttlMs: 1000 });

    await cache.get(0);
    cache.invalidate();

    expect(await cache.get(1)).toBe("second");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reads the ttl at store time when given a function", async () => {
    const load = vi.fn().mockResolvedValue("snapshot");
    const ttlMs = vi.fn().mockReturnValue(500);
    const cache = createSnapshotCache({ load, ttlMs });

    await cache.get(0);

    expect(await cache.get(499)).toBe("snapshot");
    await cache.get(500);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
