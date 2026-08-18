import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_LIVE_EVENTS } from "../../../shared/settingsDefaults";

const mockGetConfig = vi.fn();
const mockIsConfigured = vi.fn();
const mockResolve = vi.fn();
const mockSweep = vi.fn();
const mockGeoSweep = vi.fn();
const mockNotify = vi.fn();

vi.mock("../../config", () => ({
  getConfig: () => mockGetConfig(),
}));

vi.mock("../../api/jambase/config", () => ({
  isLiveEventsConfigured: () => mockIsConfigured(),
}));

vi.mock("./resolution", () => ({
  resolveFollowedArtists: (...args: unknown[]) => mockResolve(...args),
}));

vi.mock("./rosterSweep", () => ({
  runRosterSweep: () => mockSweep(),
}));

vi.mock("./geoSweep", () => ({
  runGeoSweep: () => mockGeoSweep(),
}));

vi.mock("./notifier", () => ({
  notifyLiveUpdates: () => mockNotify(),
}));

const {
  runLivePollOnce,
  startLiveEventsPoller,
  restartLiveEventsPoller,
  stopLiveEventsPoller,
} = await import("./poller");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockIsConfigured.mockReturnValue(true);
  mockResolve.mockResolvedValue({
    attempted: 0,
    resolved: 0,
    missing: 0,
    failed: 0,
  });
  mockSweep.mockResolvedValue({ ran: true });
  mockGeoSweep.mockResolvedValue({ ran: true });
  mockNotify.mockResolvedValue({ announced: 0, statusChanges: 0 });
  mockGetConfig.mockReturnValue({
    liveEvents: { ...DEFAULT_LIVE_EVENTS, enabled: true, apiKey: "k" },
  });
});

afterEach(() => {
  stopLiveEventsPoller();
  vi.useRealTimers();
});

describe("runLivePollOnce", () => {
  it("resolves before sweeping, so newly followed artists are included", async () => {
    const order: string[] = [];
    mockResolve.mockImplementation(async () => {
      order.push("resolve");
      return { attempted: 0, resolved: 0, missing: 0, failed: 0 };
    });
    mockSweep.mockImplementation(async () => {
      order.push("sweep");
      return { ran: true };
    });

    await runLivePollOnce();

    expect(order).toEqual(["resolve", "sweep"]);
  });

  it("sweeps the roster before the nearby radius", async () => {
    const order: string[] = [];
    mockSweep.mockImplementation(async () => {
      order.push("roster");
      return { ran: true };
    });
    mockGeoSweep.mockImplementation(async () => {
      order.push("geo");
      return { ran: true };
    });

    await runLivePollOnce();

    expect(order).toEqual(["roster", "geo"]);
  });

  it("notifies only after both sweeps have landed their data", async () => {
    const order: string[] = [];
    mockSweep.mockImplementation(async () => {
      order.push("roster");
      return { ran: true };
    });
    mockGeoSweep.mockImplementation(async () => {
      order.push("geo");
      return { ran: true };
    });
    mockNotify.mockImplementation(async () => {
      order.push("notify");
      return { announced: 0, statusChanges: 0 };
    });

    await runLivePollOnce();

    expect(order).toEqual(["roster", "geo", "notify"]);
  });

  it("caps resolution per tick", async () => {
    await runLivePollOnce();
    expect(mockResolve).toHaveBeenCalledWith(25);
  });

  it("does nothing when unconfigured", async () => {
    mockIsConfigured.mockReturnValue(false);
    await runLivePollOnce();

    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it("does not overlap itself", async () => {
    let release: () => void = () => {};
    mockResolve.mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve))
    );

    const first = runLivePollOnce();
    await runLivePollOnce();

    expect(mockResolve).toHaveBeenCalledTimes(1);

    release();
    await first;
  });

  it("clears the running flag after a failure", async () => {
    mockResolve.mockRejectedValueOnce(new Error("boom"));
    await expect(runLivePollOnce()).rejects.toThrow("boom");

    mockResolve.mockResolvedValue({
      attempted: 0,
      resolved: 0,
      missing: 0,
      failed: 0,
    });
    await runLivePollOnce();
    expect(mockSweep).toHaveBeenCalledTimes(1);
  });
});

describe("startLiveEventsPoller", () => {
  it("waits before the first run rather than firing during boot", async () => {
    startLiveEventsPoller(60_000);
    expect(mockResolve).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(45_000);
    expect(mockResolve).toHaveBeenCalledTimes(1);
  });

  it("reschedules itself after each tick", async () => {
    startLiveEventsPoller(60_000);

    await vi.advanceTimersByTimeAsync(45_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockResolve).toHaveBeenCalledTimes(2);
  });

  it("keeps ticking after a failed run", async () => {
    mockSweep.mockRejectedValueOnce(new Error("boom"));
    startLiveEventsPoller(60_000);

    await vi.advanceTimersByTimeAsync(45_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockSweep).toHaveBeenCalledTimes(2);
  });

  it("derives its interval from config when none is given", async () => {
    mockGetConfig.mockReturnValue({
      liveEvents: {
        ...DEFAULT_LIVE_EVENTS,
        enabled: true,
        apiKey: "k",
        sweepIntervalHours: 2,
      },
    });

    startLiveEventsPoller();
    await vi.advanceTimersByTimeAsync(45_000);
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);

    expect(mockResolve).toHaveBeenCalledTimes(2);
  });

  it("only schedules one timer", async () => {
    startLiveEventsPoller(60_000);
    startLiveEventsPoller(60_000);

    await vi.advanceTimersByTimeAsync(45_000);
    expect(mockResolve).toHaveBeenCalledTimes(1);
  });

  it("stops cleanly", async () => {
    startLiveEventsPoller(60_000);
    stopLiveEventsPoller();

    await vi.advanceTimersByTimeAsync(200_000);
    expect(mockResolve).not.toHaveBeenCalled();
  });
});

describe("restartLiveEventsPoller", () => {
  it("waits a full interval after a restart rather than the boot delay", async () => {
    startLiveEventsPoller(60_000);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(mockResolve).toHaveBeenCalledTimes(1);

    restartLiveEventsPoller(120_000);

    await vi.advanceTimersByTimeAsync(45_000);
    expect(mockResolve).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(75_000);
    expect(mockResolve).toHaveBeenCalledTimes(2);
  });

  it("replaces the interval the running timer captured", async () => {
    startLiveEventsPoller(60 * 60 * 1000);
    restartLiveEventsPoller(90_000);

    await vi.advanceTimersByTimeAsync(90_000);
    expect(mockResolve).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(90_000);
    expect(mockResolve).toHaveBeenCalledTimes(2);
  });

  it("reads the new interval from config when none is given", async () => {
    startLiveEventsPoller(60_000);
    mockGetConfig.mockReturnValue({
      liveEvents: {
        ...DEFAULT_LIVE_EVENTS,
        enabled: true,
        apiKey: "k",
        sweepIntervalHours: 1,
      },
    });

    restartLiveEventsPoller();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mockResolve).toHaveBeenCalledTimes(1);
  });
});
