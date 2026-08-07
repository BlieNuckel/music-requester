import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry, retryAfterMs } from "./retry";

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await withRetry(fn);

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable errors and succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue("ok");

    const promise = withRetry(fn, { baseDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting all retries", async () => {
    vi.useRealTimers();
    const error = new TypeError("network error");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow(
      "network error"
    );
    expect(fn).toHaveBeenCalledTimes(3);

    vi.useFakeTimers();
  });

  it("does not retry non-retryable errors", async () => {
    const error = Object.assign(new Error("Not found"), { status: 404 });
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn)).rejects.toThrow("Not found");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 status errors", async () => {
    const error = Object.assign(new Error("Rate limited"), { status: 429 });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ok");

    const promise = withRetry(fn, { baseDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on 500 status errors", async () => {
    const error = Object.assign(new Error("Server error"), { status: 500 });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ok");

    const promise = withRetry(fn, { baseDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("uses exponential backoff", async () => {
    const error = new TypeError("fetch failed");
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValue("ok");

    const promise = withRetry(fn, { retries: 2, baseDelayMs: 100 });

    // First retry after 100ms (100 * 2^0)
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(2);

    // Second retry after 200ms (100 * 2^1)
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("uses custom retryOn function", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("custom"))
      .mockResolvedValue("ok");

    const promise = withRetry(fn, {
      baseDelayMs: 100,
      retryOn: (err) => err instanceof Error && err.message === "custom",
    });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("respects retries count of 0", async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError("fail"));

    await expect(withRetry(fn, { retries: 0 })).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on ECONNRESET errors", async () => {
    const error = Object.assign(new Error("connection reset"), {
      code: "ECONNRESET",
    });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ok");

    const promise = withRetry(fn, { baseDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on ECONNREFUSED errors", async () => {
    const error = Object.assign(new Error("connection refused"), {
      code: "ECONNREFUSED",
    });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ok");

    const promise = withRetry(fn, { baseDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on ETIMEDOUT errors", async () => {
    const error = Object.assign(new Error("timed out"), {
      code: "ETIMEDOUT",
    });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ok");

    const promise = withRetry(fn, { baseDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries when error code is on the cause", async () => {
    const cause = Object.assign(new Error("reset"), { code: "ECONNRESET" });
    const error = Object.assign(new Error("fetch failed"), { cause });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ok");

    const promise = withRetry(fn, { baseDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("timeout errors", () => {
  it("retries an AbortSignal.timeout rejection", async () => {
    vi.useRealTimers();
    const timeout = new DOMException("The operation timed out", "TimeoutError");
    const fn = vi.fn().mockRejectedValueOnce(timeout).mockResolvedValue("ok");

    expect(await withRetry(fn, { baseDelayMs: 1 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useFakeTimers();
  });

  it("retries undici socket and header timeouts", async () => {
    vi.useRealTimers();
    const error = Object.assign(new Error("headers timeout"), {
      code: "UND_ERR_HEADERS_TIMEOUT",
    });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ok");

    expect(await withRetry(fn, { baseDelayMs: 1 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useFakeTimers();
  });
});

describe("retryOnResult", () => {
  it("retries a resolved value the caller considers retryable", async () => {
    vi.useRealTimers();
    const fn = vi.fn().mockResolvedValueOnce("bad").mockResolvedValue("good");

    const result = await withRetry(fn, {
      baseDelayMs: 1,
      retryOnResult: (value) => value === "bad",
    });

    expect(result).toBe("good");
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useFakeTimers();
  });

  it("returns the last value rather than throwing once retries run out", async () => {
    vi.useRealTimers();
    const fn = vi.fn().mockResolvedValue("bad");

    const result = await withRetry(fn, {
      retries: 2,
      baseDelayMs: 1,
      retryOnResult: () => true,
    });

    expect(result).toBe("bad");
    expect(fn).toHaveBeenCalledTimes(3);
    vi.useFakeTimers();
  });

  it("uses delayForResult in place of the backoff", async () => {
    const fn = vi.fn().mockResolvedValueOnce("bad").mockResolvedValue("good");

    const promise = withRetry(fn, {
      baseDelayMs: 10_000,
      retryOnResult: (value) => value === "bad",
      delayForResult: () => 50,
    });

    await vi.advanceTimersByTimeAsync(50);
    expect(await promise).toBe("good");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("retryAfterMs", () => {
  function withHeader(value: string | null): Response {
    return { headers: { get: () => value } } as unknown as Response;
  }

  it("reads a delay in seconds", () => {
    expect(retryAfterMs(withHeader("5"))).toBe(5000);
  });

  it("reads an HTTP date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    expect(retryAfterMs(withHeader("Thu, 01 Jan 2026 00:00:10 GMT"))).toBe(
      10_000
    );
  });

  it("returns undefined when the header is absent or unparseable", () => {
    expect(retryAfterMs(withHeader(null))).toBeUndefined();
    expect(retryAfterMs(withHeader("soon"))).toBeUndefined();
  });

  it("caps an unreasonably long delay", () => {
    expect(retryAfterMs(withHeader("3600"))).toBe(30_000);
  });

  it("never returns a negative delay for a past date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    expect(retryAfterMs(withHeader("Thu, 01 Jan 2020 00:00:00 GMT"))).toBe(0);
  });
});
