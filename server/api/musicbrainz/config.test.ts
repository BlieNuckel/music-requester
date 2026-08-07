import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAcquireMbSlot = vi.fn();
const mockResilientFetch = vi.fn();
const mockReportMbSuccess = vi.fn();
const mockReportMbThrottled = vi.fn();

vi.mock("./queue", () => ({
  acquireMbSlot: (...args: unknown[]) => mockAcquireMbSlot(...args),
  reportMbSuccess: (...args: unknown[]) => mockReportMbSuccess(...args),
  reportMbThrottled: (...args: unknown[]) => mockReportMbThrottled(...args),
}));

vi.mock("../resilientFetch", () => ({
  resilientFetch: (...args: unknown[]) => mockResilientFetch(...args),
}));

import { mbFetch, mbJson, MB_BASE, MB_HEADERS } from "./config";

function response(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAcquireMbSlot.mockResolvedValue(undefined);
  mockResilientFetch.mockResolvedValue({ ok: true });
});

describe("mbFetch", () => {
  it("waits for a queue slot before fetching", async () => {
    const order: string[] = [];
    mockAcquireMbSlot.mockImplementation(() => {
      order.push("acquire");
      return Promise.resolve();
    });
    mockResilientFetch.mockImplementation(() => {
      order.push("fetch");
      return Promise.resolve({ ok: true });
    });

    await mbFetch(`${MB_BASE}/artist/abc?fmt=json`);

    expect(order).toEqual(["acquire", "fetch"]);
  });

  it("queues on the interactive lane by default", async () => {
    await mbFetch(`${MB_BASE}/artist/abc?fmt=json`);
    expect(mockAcquireMbSlot).toHaveBeenCalledWith("interactive");
  });

  it("queues on the lane it is given", async () => {
    await mbFetch(`${MB_BASE}/artist/abc?fmt=json`, "background");
    expect(mockAcquireMbSlot).toHaveBeenCalledWith("background");
  });

  it("sends the MusicBrainz headers", async () => {
    const url = `${MB_BASE}/artist/abc?fmt=json`;
    await mbFetch(url);
    expect(mockResilientFetch).toHaveBeenCalledWith(
      url,
      { headers: MB_HEADERS },
      { retry: false }
    );
  });

  it("does not swallow a failed slot acquisition", async () => {
    mockAcquireMbSlot.mockRejectedValue(new Error("queue closed"));
    await expect(mbFetch(`${MB_BASE}/artist/abc`)).rejects.toThrow(
      "queue closed"
    );
    expect(mockResilientFetch).not.toHaveBeenCalled();
  });
});

describe("mbJson", () => {
  it("parses a successful response", async () => {
    mockResilientFetch.mockResolvedValue(response(200, { id: "abc" }));
    expect(await mbJson(`${MB_BASE}/artist/abc`)).toEqual({ id: "abc" });
  });

  it("returns null when the entity does not exist", async () => {
    mockResilientFetch.mockResolvedValue(response(404));
    expect(await mbJson(`${MB_BASE}/artist/missing`)).toBeNull();
  });

  it("returns null for an MBID MusicBrainz rejects outright", async () => {
    mockResilientFetch.mockResolvedValue(response(400));
    expect(await mbJson(`${MB_BASE}/artist/not-a-mbid`)).toBeNull();
  });

  it("throws when MusicBrainz is throttling, so it is not cached as a miss", async () => {
    mockResilientFetch.mockResolvedValue(response(503));
    await expect(mbJson(`${MB_BASE}/artist/abc`)).rejects.toThrow(
      "MusicBrainz returned 503"
    );
  });

  it("throws on rate limiting", async () => {
    mockResilientFetch.mockResolvedValue(response(429));
    await expect(mbJson(`${MB_BASE}/artist/abc`)).rejects.toThrow(
      "MusicBrainz returned 429"
    );
  });

  it("queues on the lane it is given", async () => {
    mockResilientFetch.mockResolvedValue(response(200, {}));
    await mbJson(`${MB_BASE}/artist/abc`, "background");
    expect(mockAcquireMbSlot).toHaveBeenCalledWith("background");
  });
});

describe("mbFetch retries", () => {
  it("retries a throttled response and returns the eventual success", async () => {
    mockResilientFetch
      .mockResolvedValueOnce(response(503))
      .mockResolvedValue(response(200, {}));

    const result = await mbFetch(`${MB_BASE}/artist/abc`);

    expect(result.status).toBe(200);
    expect(mockResilientFetch).toHaveBeenCalledTimes(2);
  });

  it("takes a fresh queue slot for every attempt", async () => {
    mockResilientFetch
      .mockResolvedValueOnce(response(503))
      .mockResolvedValue(response(200, {}));

    await mbFetch(`${MB_BASE}/artist/abc`, "background");

    expect(mockAcquireMbSlot).toHaveBeenCalledTimes(2);
    expect(mockAcquireMbSlot).toHaveBeenNthCalledWith(1, "background");
    expect(mockAcquireMbSlot).toHaveBeenNthCalledWith(2, "background");
  });

  it("gives up and returns the last response once retries run out", async () => {
    mockResilientFetch.mockResolvedValue(response(503));

    const result = await mbFetch(`${MB_BASE}/artist/abc`);

    expect(result.status).toBe(503);
    expect(mockResilientFetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry a status that will not change", async () => {
    mockResilientFetch.mockResolvedValue(response(404));

    await mbFetch(`${MB_BASE}/artist/abc`);

    expect(mockResilientFetch).toHaveBeenCalledTimes(1);
  });

  it("retries a request that timed out", async () => {
    mockResilientFetch
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
      .mockResolvedValue(response(200, {}));

    const result = await mbFetch(`${MB_BASE}/artist/abc`);

    expect(result.status).toBe(200);
    expect(mockResilientFetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry an error that will not resolve itself", async () => {
    mockResilientFetch.mockRejectedValue(new Error("bad url"));

    await expect(mbFetch(`${MB_BASE}/artist/abc`)).rejects.toThrow("bad url");
    expect(mockResilientFetch).toHaveBeenCalledTimes(1);
  });

  it("leaves retrying to itself rather than to resilientFetch", async () => {
    mockResilientFetch.mockResolvedValue(response(200, {}));

    await mbFetch(`${MB_BASE}/artist/abc`);

    expect(mockResilientFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      { retry: false }
    );
  });
});

describe("mbFetch throttle reporting", () => {
  it("trips the breaker on a throttled response", async () => {
    mockResilientFetch.mockResolvedValue(response(503));
    await mbFetch(`${MB_BASE}/artist/abc`);
    expect(mockReportMbThrottled).toHaveBeenCalled();
  });

  it("passes Retry-After through to the breaker", async () => {
    mockResilientFetch.mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => "12" },
      json: () => Promise.resolve({}),
    });

    await mbFetch(`${MB_BASE}/artist/abc`);

    expect(mockReportMbThrottled).toHaveBeenCalledWith(12);
  });

  it("clears the breaker when MusicBrainz answers", async () => {
    mockResilientFetch.mockResolvedValue(response(200, {}));
    await mbFetch(`${MB_BASE}/artist/abc`);
    expect(mockReportMbSuccess).toHaveBeenCalled();
    expect(mockReportMbThrottled).not.toHaveBeenCalled();
  });

  it("treats a 404 as MusicBrainz being healthy", async () => {
    mockResilientFetch.mockResolvedValue(response(404));
    await mbFetch(`${MB_BASE}/artist/missing`);
    expect(mockReportMbSuccess).toHaveBeenCalled();
  });

  it("does not trip the breaker on a one-off server fault", async () => {
    mockResilientFetch.mockResolvedValue(response(500));
    await mbFetch(`${MB_BASE}/artist/abc`);
    expect(mockReportMbThrottled).not.toHaveBeenCalled();
  });
});
