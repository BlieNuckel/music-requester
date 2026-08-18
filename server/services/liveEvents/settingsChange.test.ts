import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_LIVE_EVENTS } from "../../../shared/settingsDefaults";
import type { LiveEventsSettings } from "../../../shared/settingsDefaults";

const mockGetConfig = vi.fn();
const mockIsConfigured = vi.fn();
const mockRunLivePollOnce = vi.fn();
const mockRestartPoller = vi.fn();
const mockLogError = vi.fn();

vi.mock("../../config", () => ({
  getConfig: () => mockGetConfig(),
}));

vi.mock("../../api/jambase/config", () => ({
  isLiveEventsConfigured: () => mockIsConfigured(),
}));

vi.mock("./poller", () => ({
  runLivePollOnce: () => mockRunLivePollOnce(),
  restartLiveEventsPoller: (...args: unknown[]) => mockRestartPoller(...args),
}));

vi.mock("../../logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: mockLogError }),
}));

const {
  snapshotLiveEventsSettings,
  onLiveEventsSettingsSaved,
  resetLiveEventsKickThrottle,
} = await import("./settingsChange");

const THROTTLE_MS = 5 * 60 * 1000;

/** Point the mocked config and configured check at one liveEvents state. */
function setLiveEvents(overrides: Partial<LiveEventsSettings> = {}) {
  const liveEvents = { ...DEFAULT_LIVE_EVENTS, ...overrides };
  mockGetConfig.mockReturnValue({ liveEvents });
  mockIsConfigured.mockReturnValue(
    liveEvents.enabled && liveEvents.apiKey.length > 0
  );
}

/** Snapshot one state, then save another, the way the settings route does. */
function save(
  before: Partial<LiveEventsSettings>,
  after: Partial<LiveEventsSettings>
) {
  setLiveEvents(before);
  const snapshot = snapshotLiveEventsSettings();
  setLiveEvents(after);
  onLiveEventsSettingsSaved(snapshot);
}

const UNCONFIGURED: Partial<LiveEventsSettings> = {
  enabled: false,
  apiKey: "",
};
const CONFIGURED: Partial<LiveEventsSettings> = { enabled: true, apiKey: "k" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  resetLiveEventsKickThrottle();
  mockRunLivePollOnce.mockResolvedValue(undefined);
  setLiveEvents();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("snapshotLiveEventsSettings", () => {
  it("reports an origin only when both coordinates are set", () => {
    setLiveEvents({ ...CONFIGURED, originLat: 55.6, originLon: null });
    expect(snapshotLiveEventsSettings()).toEqual({
      configured: true,
      hasOrigin: false,
      sweepIntervalHours: DEFAULT_LIVE_EVENTS.sweepIntervalHours,
    });
  });
});

describe("onLiveEventsSettingsSaved", () => {
  it("sweeps once when the save makes the integration usable", () => {
    save(UNCONFIGURED, CONFIGURED);
    expect(mockRunLivePollOnce).toHaveBeenCalledTimes(1);
  });

  it("sweeps when coordinates arrive, since the geo sweep bails on a null origin", () => {
    save(CONFIGURED, { ...CONFIGURED, originLat: 55.6, originLon: 13.0 });
    expect(mockRunLivePollOnce).toHaveBeenCalledTimes(1);
  });

  it("does not sweep for an unrelated field change", () => {
    save(
      { ...CONFIGURED, originLat: 55.6, originLon: 13.0 },
      { ...CONFIGURED, originLat: 55.6, originLon: 13.0, shelfHorizonDays: 60 }
    );
    expect(mockRunLivePollOnce).not.toHaveBeenCalled();
  });

  it("does not sweep when the save leaves the integration unusable", () => {
    save(UNCONFIGURED, { enabled: true, apiKey: "" });
    expect(mockRunLivePollOnce).not.toHaveBeenCalled();
  });

  it("does not sweep when the integration is switched off", () => {
    save(CONFIGURED, UNCONFIGURED);
    expect(mockRunLivePollOnce).not.toHaveBeenCalled();
  });

  it("collapses repeated saves inside the throttle window into one sweep", () => {
    save(UNCONFIGURED, CONFIGURED);
    save(UNCONFIGURED, CONFIGURED);
    expect(mockRunLivePollOnce).toHaveBeenCalledTimes(1);
  });

  it("sweeps again once the throttle window has passed", () => {
    save(UNCONFIGURED, CONFIGURED);
    vi.advanceTimersByTime(THROTTLE_MS);
    save(UNCONFIGURED, CONFIGURED);
    expect(mockRunLivePollOnce).toHaveBeenCalledTimes(2);
  });

  it("restarts the poller when the sweep interval changed", () => {
    save(CONFIGURED, { ...CONFIGURED, sweepIntervalHours: 6 });
    expect(mockRestartPoller).toHaveBeenCalledTimes(1);
  });

  it("leaves the running timer alone when the interval is unchanged", () => {
    save(UNCONFIGURED, CONFIGURED);
    expect(mockRestartPoller).not.toHaveBeenCalled();
  });

  it("logs a failed sweep instead of rejecting into the caller", async () => {
    mockRunLivePollOnce.mockRejectedValue(new Error("boom"));

    expect(() => save(UNCONFIGURED, CONFIGURED)).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockLogError).toHaveBeenCalledWith(
      "Kicked live poll failed",
      expect.any(Error)
    );
  });
});
