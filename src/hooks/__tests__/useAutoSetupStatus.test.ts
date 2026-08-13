import { renderHook, waitFor } from "@testing-library/react";

const mockUseSettings = vi.fn();

vi.mock("@/context/useSettings", () => ({
  useSettings: () => mockUseSettings(),
}));

import useAutoSetupStatus from "../useAutoSetupStatus";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  mockUseSettings.mockReturnValue({ isConnected: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAutoSetupStatus", () => {
  it("fetches status when connected", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          indexerExists: true,
          downloadClientExists: false,
        }),
        { status: 200 }
      )
    );

    const { result } = renderHook(() => useAutoSetupStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.status).toEqual({
      indexerExists: true,
      downloadClientExists: false,
    });
    expect(fetch).toHaveBeenCalledWith("/api/lidarr/auto-setup/status", {
      signal: expect.any(AbortSignal),
    });
  });

  it("does not fetch when disconnected", async () => {
    mockUseSettings.mockReturnValue({ isConnected: false });

    const { result } = renderHook(() => useAutoSetupStatus());

    expect(result.current.status).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sets status to null on fetch error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useAutoSetupStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.status).toBeNull();
  });

  it("sets status to null on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Error", { status: 500 })
    );

    const { result } = renderHook(() => useAutoSetupStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.status).toBeNull();
  });

  it("refetch triggers a new fetch", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          indexerExists: false,
          downloadClientExists: false,
        }),
        { status: 200 }
      )
    );

    const { result } = renderHook(() => useAutoSetupStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await result.current.refetch();

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
