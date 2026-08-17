import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_LIVE_EVENTS } from "../../../shared/settingsDefaults";

const mockGetConfig = vi.fn();
const mockResilientFetch = vi.fn();

vi.mock("../../config", () => ({
  getConfig: () => mockGetConfig(),
}));

vi.mock("../resilientFetch", () => ({
  resilientFetch: (...args: unknown[]) => mockResilientFetch(...args),
}));

const { jambaseGet, setCallRecorder } = await import("./fetch");
const { JambaseError } = await import("./config");

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function badJsonResponse(status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error("Unexpected token <");
    },
  } as unknown as Response;
}

function lastUrl(): string {
  const calls = mockResilientFetch.mock.calls;
  return calls[calls.length - 1]?.[0] as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  setCallRecorder(null);
  mockGetConfig.mockReturnValue({
    liveEvents: { ...DEFAULT_LIVE_EVENTS, enabled: true, apiKey: "jbd_test" },
  });
});

afterEach(() => {
  setCallRecorder(null);
});

describe("jambaseGet", () => {
  it("sends bearer auth to the v3 host and returns the parsed body", async () => {
    mockResilientFetch.mockResolvedValue(jsonResponse({ success: true }));

    const result = await jambaseGet<{ success: boolean }>("/events");

    expect(result).toEqual({ success: true });
    expect(lastUrl()).toBe("https://api.data.jambase.com/v3/events");
    const init = mockResilientFetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer jbd_test"
    );
  });

  it("builds a query string and drops undefined and empty params", async () => {
    mockResilientFetch.mockResolvedValue(jsonResponse({}));

    await jambaseGet("/events", {
      perPage: 100,
      geoCountryIso2: "SE|DK",
      dateModifiedFrom: undefined,
      name: "",
    });

    const url = new URL(lastUrl());
    expect(url.searchParams.get("perPage")).toBe("100");
    expect(url.searchParams.get("geoCountryIso2")).toBe("SE|DK");
    expect(url.searchParams.has("dateModifiedFrom")).toBe(false);
    expect(url.searchParams.has("name")).toBe(false);
  });

  it("classifies 403 as plan-gated rather than parsing the body as data", async () => {
    mockResilientFetch.mockResolvedValue(
      jsonResponse({ title: "Plan Feature Required" }, 403)
    );

    await expect(jambaseGet("/events")).rejects.toMatchObject({
      name: "JambaseError",
      kind: "plan-gated",
      status: 403,
    });
  });

  it("classifies the other statuses we act on differently", async () => {
    const cases: [number, string][] = [
      [401, "unauthorized"],
      [404, "not-found"],
      [429, "rate-limited"],
      [500, "transient"],
      [503, "transient"],
    ];

    for (const [status, kind] of cases) {
      mockResilientFetch.mockResolvedValue(jsonResponse({}, status));
      await expect(jambaseGet("/events")).rejects.toMatchObject({
        kind,
        status,
      });
    }
  });

  it("does not retry a status, so a 4xx costs one call and not several", async () => {
    mockResilientFetch.mockResolvedValue(jsonResponse({}, 403));

    await expect(jambaseGet("/events")).rejects.toThrow(JambaseError);
    expect(mockResilientFetch).toHaveBeenCalledTimes(1);

    const options = mockResilientFetch.mock.calls[0][2] as {
      retryOnStatus?: boolean;
    };
    expect(options.retryOnStatus).toBeUndefined();
  });

  it("reports a non-JSON body as malformed instead of throwing raw", async () => {
    mockResilientFetch.mockResolvedValue(badJsonResponse());

    await expect(jambaseGet("/events")).rejects.toMatchObject({
      kind: "malformed",
      status: 200,
    });
  });

  it("wraps a network failure as transient", async () => {
    mockResilientFetch.mockRejectedValue(new Error("ECONNRESET"));

    await expect(jambaseGet("/events")).rejects.toMatchObject({
      kind: "transient",
      status: null,
    });
  });

  it("refuses to call at all when unconfigured", async () => {
    mockGetConfig.mockReturnValue({
      liveEvents: { ...DEFAULT_LIVE_EVENTS, enabled: true, apiKey: "" },
    });

    await expect(jambaseGet("/events")).rejects.toThrow(
      "JamBase API key not configured"
    );
    expect(mockResilientFetch).not.toHaveBeenCalled();
  });
});

describe("call accounting", () => {
  it("records a successful call once", async () => {
    const recorder = vi.fn();
    setCallRecorder(recorder);
    mockResilientFetch.mockResolvedValue(jsonResponse({}));

    await jambaseGet("/events");

    expect(recorder).toHaveBeenCalledTimes(1);
    expect(recorder).toHaveBeenCalledWith({ status: 200, endpoint: "/events" });
  });

  it("records a 4xx, because those are billable too", async () => {
    const recorder = vi.fn();
    setCallRecorder(recorder);
    mockResilientFetch.mockResolvedValue(jsonResponse({}, 404));

    await expect(jambaseGet("/events")).rejects.toThrow();
    expect(recorder).toHaveBeenCalledWith({ status: 404, endpoint: "/events" });
  });

  it("records a network failure with a null status", async () => {
    const recorder = vi.fn();
    setCallRecorder(recorder);
    mockResilientFetch.mockRejectedValue(new Error("boom"));

    await expect(jambaseGet("/events")).rejects.toThrow();
    expect(recorder).toHaveBeenCalledWith({
      status: null,
      endpoint: "/events",
    });
  });

  it("does not record when the call never left the process", async () => {
    const recorder = vi.fn();
    setCallRecorder(recorder);
    mockGetConfig.mockReturnValue({
      liveEvents: { ...DEFAULT_LIVE_EVENTS, enabled: false, apiKey: "k" },
    });

    await expect(jambaseGet("/events")).rejects.toThrow();
    expect(recorder).not.toHaveBeenCalled();
  });
});
