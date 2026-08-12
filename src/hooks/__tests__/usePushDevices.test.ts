import { renderHook, waitFor, act } from "@testing-library/react";
import usePushDevices from "../usePushDevices";

const mockFetch = vi.fn();
const mockSubscribeToPush = vi.fn();
const mockUnsubscribeFromPush = vi.fn();
const mockGetCurrentEndpoint = vi.fn();
const mockGetPushPermission = vi.fn();

vi.mock("@/pushSubscription", () => ({
  subscribeToPush: (...args: unknown[]) => mockSubscribeToPush(...args),
  unsubscribeFromPush: (...args: unknown[]) => mockUnsubscribeFromPush(...args),
  getCurrentEndpoint: (...args: unknown[]) => mockGetCurrentEndpoint(...args),
  getPushPermission: (...args: unknown[]) => mockGetPushPermission(...args),
}));

const DEVICE = {
  id: 1,
  endpoint: "https://push.example/abc",
  userAgent: "TestBrowser",
  createdAt: "2026-08-01T10:00:00.000Z",
  lastSeenAt: "2026-08-10T10:00:00.000Z",
};

/**
 * `useAsyncData.refresh()` settles inside an effect, and act() will not flush
 * effects until its own callback resolves — awaiting the action directly inside
 * act deadlocks. Start it in one act, await it in the next.
 */
async function runAction(action: () => Promise<void>): Promise<void> {
  let promise!: Promise<void>;
  act(() => {
    promise = action();
  });
  await act(async () => {
    await promise;
  });
}

function mockDevices(devices: unknown[]) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ devices }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  mockGetPushPermission.mockReturnValue("default");
  mockGetCurrentEndpoint.mockResolvedValue(null);
  mockDevices([DEVICE]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loading", () => {
  it("fetches devices when push is available", async () => {
    const { result } = renderHook(() => usePushDevices(true));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockFetch).toHaveBeenCalledWith("/api/notifications/devices");
    expect(result.current.devices).toEqual([DEVICE]);
  });

  it("skips the request entirely when push is unavailable", () => {
    const { result } = renderHook(() => usePushDevices(false));

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.devices).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("exposes a load error", async () => {
    mockFetch.mockResolvedValue({ ok: false });

    const { result } = renderHook(() => usePushDevices(true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to load your devices");
  });

  it("reports the endpoint of the current browser", async () => {
    mockGetCurrentEndpoint.mockResolvedValue(DEVICE.endpoint);

    const { result } = renderHook(() => usePushDevices(true));

    await waitFor(() =>
      expect(result.current.currentEndpoint).toBe(DEVICE.endpoint)
    );
  });
});

describe("subscribe", () => {
  it("subscribes, refreshes the list, and re-reads the permission", async () => {
    mockGetPushPermission.mockReturnValue("granted");
    const { result } = renderHook(() => usePushDevices(true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await runAction(() => result.current.subscribe());

    expect(mockSubscribeToPush).toHaveBeenCalled();
    expect(result.current.permission).toBe("granted");
    expect(result.current.actionError).toBeNull();
  });

  it("surfaces a refused permission without breaking the hook", async () => {
    mockSubscribeToPush.mockRejectedValue(
      new Error("Notification permission was not granted")
    );
    const { result } = renderHook(() => usePushDevices(true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await runAction(() => result.current.subscribe());

    expect(result.current.actionError).toBe(
      "Notification permission was not granted"
    );
    expect(result.current.busy).toBe(false);
  });
});

describe("unsubscribe and revoke", () => {
  it("unsubscribes this browser", async () => {
    const { result } = renderHook(() => usePushDevices(true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await runAction(() => result.current.unsubscribe());

    expect(mockUnsubscribeFromPush).toHaveBeenCalled();
  });

  it("revokes another device by id", async () => {
    const { result } = renderHook(() => usePushDevices(true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await runAction(() => result.current.revoke(7));

    expect(mockFetch).toHaveBeenCalledWith("/api/notifications/devices/7", {
      method: "DELETE",
    });
  });

  it("reports a failed revoke", async () => {
    const { result } = renderHook(() => usePushDevices(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    mockFetch.mockResolvedValueOnce({ ok: false });

    await runAction(() => result.current.revoke(7));

    expect(result.current.actionError).toBe("Failed to remove that device");
  });
});

describe("sendTest", () => {
  it("posts to the self-service test endpoint", async () => {
    const { result } = renderHook(() => usePushDevices(true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await runAction(() => result.current.sendTest());

    expect(mockFetch).toHaveBeenCalledWith("/api/notifications/webpush/test", {
      method: "POST",
    });
  });

  it("surfaces the server's reason for refusing", async () => {
    const { result } = renderHook(() => usePushDevices(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({ error: "This account has no subscribed devices" }),
    });

    await runAction(() => result.current.sendTest());

    expect(result.current.actionError).toBe(
      "This account has no subscribed devices"
    );
  });
});
