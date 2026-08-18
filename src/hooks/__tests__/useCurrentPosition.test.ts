import { renderHook, act, waitFor } from "@testing-library/react";
import useCurrentPosition from "../useCurrentPosition";

const mockGetCurrentPosition = vi.fn();

function stubEnvironment(
  options: {
    secure?: boolean;
    geolocation?: boolean;
  } = {}
) {
  vi.stubGlobal("isSecureContext", options.secure ?? true);
  vi.stubGlobal("navigator", {
    geolocation:
      (options.geolocation ?? true)
        ? { getCurrentPosition: mockGetCurrentPosition }
        : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  stubEnvironment();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCurrentPosition", () => {
  it("hands the caller coordinates rounded to the input's precision", async () => {
    mockGetCurrentPosition.mockImplementation((onSuccess) =>
      onSuccess({ coords: { latitude: 55.60587123, longitude: 13.00073456 } })
    );
    const onLocated = vi.fn();

    const { result } = renderHook(() => useCurrentPosition());
    act(() => result.current.locate(onLocated));

    expect(onLocated).toHaveBeenCalledWith(55.6059, 13.0007);
    await waitFor(() => expect(result.current.locating).toBe(false));
  });

  it("explains that the browser needs HTTPS before it asks", () => {
    stubEnvironment({ secure: false });
    const onLocated = vi.fn();

    const { result } = renderHook(() => useCurrentPosition());
    act(() => result.current.locate(onLocated));

    expect(mockGetCurrentPosition).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/HTTPS/);
    expect(onLocated).not.toHaveBeenCalled();
  });

  it("says so when the browser has no geolocation at all", () => {
    stubEnvironment({ geolocation: false });

    const { result } = renderHook(() => useCurrentPosition());
    act(() => result.current.locate(vi.fn()));

    expect(result.current.error).toMatch(/cannot share your location/);
  });

  it("reports a denied permission in words", async () => {
    mockGetCurrentPosition.mockImplementation((_onSuccess, onError) =>
      onError({ code: 1 })
    );

    const { result } = renderHook(() => useCurrentPosition());
    act(() => result.current.locate(vi.fn()));

    await waitFor(() =>
      expect(result.current.error).toBe(
        "Location permission was denied in your browser."
      )
    );
    expect(result.current.locating).toBe(false);
  });

  it("reports a timeout in words", async () => {
    mockGetCurrentPosition.mockImplementation((_onSuccess, onError) =>
      onError({ code: 3 })
    );

    const { result } = renderHook(() => useCurrentPosition());
    act(() => result.current.locate(vi.fn()));

    await waitFor(() => expect(result.current.error).toMatch(/took too long/));
  });

  it("falls back to a generic message for an unknown error code", async () => {
    mockGetCurrentPosition.mockImplementation((_onSuccess, onError) =>
      onError({ code: 99 })
    );

    const { result } = renderHook(() => useCurrentPosition());
    act(() => result.current.locate(vi.fn()));

    await waitFor(() =>
      expect(result.current.error).toBe("Could not get your location.")
    );
  });

  it("gives up rather than waiting forever", () => {
    mockGetCurrentPosition.mockImplementation(() => {});

    const { result } = renderHook(() => useCurrentPosition());
    act(() => result.current.locate(vi.fn()));

    expect(mockGetCurrentPosition.mock.calls[0][2]).toEqual({ timeout: 10000 });
  });
});
