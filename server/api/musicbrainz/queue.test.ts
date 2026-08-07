import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  acquireMbSlot,
  getMbQueueDepth,
  getMbPauseRemainingMs,
  reportMbSuccess,
  reportMbThrottled,
  resetMbQueue,
  type MbPriority,
} from "./queue";

const INTERVAL_MS = 1100;

function track(
  priority: MbPriority,
  label: string,
  granted: string[]
): Promise<void> {
  return acquireMbSlot(priority).then(() => {
    granted.push(label);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetMbQueue();
});

afterEach(async () => {
  resetMbQueue();
  await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);
  vi.useRealTimers();
});

describe("acquireMbSlot", () => {
  it("grants the first slot immediately", async () => {
    const granted: string[] = [];
    void track("interactive", "first", granted);

    await vi.advanceTimersByTimeAsync(0);
    expect(granted).toEqual(["first"]);
  });

  it("spaces a concurrent burst one interval apart", async () => {
    const granted: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      void track("interactive", `r${i}`, granted);
    }

    await vi.advanceTimersByTimeAsync(0);
    expect(granted).toEqual(["r0"]);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(granted).toEqual(["r0", "r1"]);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(granted).toEqual(["r0", "r1", "r2"]);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(granted).toEqual(["r0", "r1", "r2", "r3"]);
  });

  it("does not release a request that arrives just after a grant", async () => {
    const granted: string[] = [];
    void track("interactive", "first", granted);
    await vi.advanceTimersByTimeAsync(0);

    void track("interactive", "second", granted);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(granted).toEqual(["first"]);

    await vi.advanceTimersByTimeAsync(1);
    expect(granted).toEqual(["first", "second"]);
  });

  it("reports the depth of each lane", async () => {
    void acquireMbSlot("interactive");
    void acquireMbSlot("interactive");
    void acquireMbSlot("background");
    await vi.advanceTimersByTimeAsync(0);

    expect(getMbQueueDepth()).toEqual({ interactive: 1, background: 1 });
  });
});

describe("lane priority", () => {
  it("lets interactive work jump ahead of queued background work", async () => {
    const granted: string[] = [];
    void track("background", "bg1", granted);
    void track("background", "bg2", granted);
    void track("interactive", "ui", granted);

    await vi.advanceTimersByTimeAsync(0);
    expect(granted).toEqual(["bg1"]);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(granted).toEqual(["bg1", "ui"]);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(granted).toEqual(["bg1", "ui", "bg2"]);
  });

  it("does not starve background work under sustained interactive load", async () => {
    const granted: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      void track("interactive", `ui${i}`, granted);
    }
    void track("background", "bg", granted);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 13);

    expect(granted[8]).toBe("bg");
    expect(granted).toHaveLength(13);
  });

  it("serves background work as soon as the interactive lane drains", async () => {
    const granted: string[] = [];
    void track("interactive", "ui1", granted);
    void track("background", "bg", granted);
    void track("interactive", "ui2", granted);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(granted).toEqual(["ui1", "ui2", "bg"]);
  });
});

describe("throttle breaker", () => {
  it("stops granting slots after MusicBrainz throttles us", async () => {
    const granted: string[] = [];
    void track("interactive", "first", granted);
    await vi.advanceTimersByTimeAsync(0);

    reportMbThrottled();
    void track("interactive", "second", granted);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(granted).toEqual(["first"]);

    await vi.advanceTimersByTimeAsync(2000);
    expect(granted).toEqual(["first", "second"]);
  });

  it("pauses both lanes, not just the one that was throttled", async () => {
    const granted: string[] = [];
    void track("interactive", "warmup", granted);
    await vi.advanceTimersByTimeAsync(0);

    reportMbThrottled();
    void track("background", "bg", granted);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(granted).toEqual(["warmup"]);

    await vi.advanceTimersByTimeAsync(2000);
    expect(granted).toEqual(["warmup", "bg"]);
  });

  it("doubles the pause while throttling continues", () => {
    reportMbThrottled();
    expect(getMbPauseRemainingMs()).toBe(2000);

    reportMbThrottled();
    expect(getMbPauseRemainingMs()).toBe(4000);

    reportMbThrottled();
    expect(getMbPauseRemainingMs()).toBe(8000);
  });

  it("waits at least as long as Retry-After asks", () => {
    reportMbThrottled(30);
    expect(getMbPauseRemainingMs()).toBe(30_000);
  });

  it("ignores a Retry-After shorter than its own backoff", () => {
    reportMbThrottled();
    reportMbThrottled();
    reportMbThrottled();
    expect(getMbPauseRemainingMs()).toBe(8000);

    reportMbThrottled(1);
    expect(getMbPauseRemainingMs()).toBe(16_000);
  });

  it("caps the pause", () => {
    for (let i = 0; i < 20; i += 1) reportMbThrottled();
    expect(getMbPauseRemainingMs()).toBe(60_000);
  });

  it("clears the pause as soon as MusicBrainz answers again", () => {
    reportMbThrottled();
    reportMbThrottled();
    expect(getMbPauseRemainingMs()).toBe(4000);

    reportMbSuccess();
    expect(getMbPauseRemainingMs()).toBe(0);

    reportMbThrottled();
    expect(getMbPauseRemainingMs()).toBe(2000);
  });
});
