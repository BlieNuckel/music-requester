import { renderHook, waitFor, act } from "@testing-library/react";
import useNotificationSettings from "../useNotificationSettings";

const mockFetch = vi.fn();

const CATALOG = {
  enabled: true,
  events: [
    {
      id: "request.approved",
      label: "Request approved",
      description: "Someone approved a request you made.",
      audience: "user",
      defaultEnabled: true,
    },
  ],
  transports: [{ id: "webpush", label: "Web push", configured: true }],
};

const PREFERENCES = {
  preferences: [
    { eventId: "request.approved", transportId: "webpush", enabled: true },
  ],
};

function mockLoad() {
  mockFetch.mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve(url.endsWith("/catalog") ? CATALOG : PREFERENCES),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useNotificationSettings", () => {
  it("loads the catalog and preferences together", async () => {
    mockLoad();

    const { result } = renderHook(() => useNotificationSettings());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.settings).toEqual({
      enabled: true,
      events: CATALOG.events,
      transports: CATALOG.transports,
      preferences: PREFERENCES.preferences,
    });
    expect(result.current.error).toBeNull();
  });

  it("exposes an error when loading fails", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const { result } = renderHook(() => useNotificationSettings());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to load notification settings");
    expect(result.current.settings).toBeNull();
  });

  it("saves a preference and applies the server's response", async () => {
    mockLoad();
    const { result } = renderHook(() => useNotificationSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updated = [
      { eventId: "request.approved", transportId: "webpush", enabled: false },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ preferences: updated }),
    });

    await act(async () => {
      await result.current.savePreference({
        eventId: "request.approved",
        transportId: "webpush",
        enabled: false,
      });
    });

    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/notifications/preferences",
      expect.objectContaining({ method: "PUT" })
    );
    expect(result.current.settings?.preferences).toEqual(updated);
    expect(result.current.saveError).toBeNull();
  });

  it("surfaces the server error message when saving fails", async () => {
    mockLoad();
    const { result } = renderHook(() => useNotificationSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "Unknown notification transport" }),
    });

    await act(async () => {
      await result.current.savePreference({
        eventId: "request.approved",
        transportId: "pigeon",
        enabled: true,
      });
    });

    expect(result.current.saveError).toBe("Unknown notification transport");
    expect(result.current.settings?.preferences).toEqual(
      PREFERENCES.preferences
    );
  });
});
