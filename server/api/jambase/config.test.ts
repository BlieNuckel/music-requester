import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_LIVE_EVENTS } from "../../../shared/settingsDefaults";

const mockGetConfig = vi.fn();

vi.mock("../../config", () => ({
  getConfig: () => mockGetConfig(),
}));

const {
  getJambaseConfig,
  isLiveEventsConfigured,
  JambaseError,
  JAMBASE_BASE_URL,
} = await import("./config");

function withLiveEvents(overrides: Record<string, unknown>) {
  mockGetConfig.mockReturnValue({
    liveEvents: { ...DEFAULT_LIVE_EVENTS, ...overrides },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getJambaseConfig", () => {
  it("returns the v3 API host with bearer auth", () => {
    withLiveEvents({ enabled: true, apiKey: "jbd_test" });

    const config = getJambaseConfig();
    expect(config.baseUrl).toBe("https://api.data.jambase.com/v3");
    expect(config.headers.Authorization).toBe("Bearer jbd_test");
  });

  it("does not point at the marketing host, which answers 200 with HTML", () => {
    expect(new URL(JAMBASE_BASE_URL).host).toBe("api.data.jambase.com");
    expect(JAMBASE_BASE_URL).toBe("https://api.data.jambase.com/v3");
  });

  it("throws when the feature is disabled", () => {
    withLiveEvents({ enabled: false, apiKey: "jbd_test" });
    expect(() => getJambaseConfig()).toThrow(JambaseError);
  });

  it("throws when no key is configured", () => {
    withLiveEvents({ enabled: true, apiKey: "" });
    expect(() => getJambaseConfig()).toThrow("JamBase API key not configured");
  });

  it("reads config on every call so a settings change needs no restart", () => {
    withLiveEvents({ enabled: true, apiKey: "first" });
    expect(getJambaseConfig().headers.Authorization).toBe("Bearer first");

    withLiveEvents({ enabled: true, apiKey: "second" });
    expect(getJambaseConfig().headers.Authorization).toBe("Bearer second");
  });
});

describe("isLiveEventsConfigured", () => {
  it("requires both the switch and a key", () => {
    withLiveEvents({ enabled: true, apiKey: "jbd_test" });
    expect(isLiveEventsConfigured()).toBe(true);

    withLiveEvents({ enabled: false, apiKey: "jbd_test" });
    expect(isLiveEventsConfigured()).toBe(false);

    withLiveEvents({ enabled: true, apiKey: "" });
    expect(isLiveEventsConfigured()).toBe(false);
  });
});
