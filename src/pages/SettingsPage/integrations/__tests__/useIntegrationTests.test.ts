import { renderHook, act, waitFor } from "@testing-library/react";
import type { AppSettings } from "@/context/settingsContextDef";

const mockTestConnection = vi.fn();
const mockTestSlskdConnection = vi.fn();
const mockLoadLidarrOptionValues = vi.fn();

vi.mock("@/context/useSettings", () => ({
  useSettings: () => ({
    testConnection: mockTestConnection,
    testSlskdConnection: mockTestSlskdConnection,
    loadLidarrOptionValues: mockLoadLidarrOptionValues,
  }),
}));

import useIntegrationTests from "../useIntegrationTests";

const fields = { lidarrUrl: "http://lidarr:8686" } as AppSettings;

const clickEvent = {
  preventDefault: vi.fn(),
} as unknown as React.MouseEvent<HTMLButtonElement>;

beforeEach(() => {
  vi.clearAllMocks();
  mockTestConnection.mockResolvedValue({ success: true, version: "2.0" });
  mockTestSlskdConnection.mockResolvedValue({
    success: true,
    soulseekConnected: true,
  });
  mockLoadLidarrOptionValues.mockResolvedValue(undefined);
});

describe("useIntegrationTests", () => {
  it("starts with neither test run", () => {
    const { result } = renderHook(() => useIntegrationTests(fields));

    expect(result.current.lidarrTest).toMatchObject({
      testing: false,
      result: null,
    });
    expect(result.current.slskdTest).toMatchObject({
      testing: false,
      result: null,
    });
  });

  it("tests Lidarr with the current fields and keeps the result", async () => {
    const { result } = renderHook(() => useIntegrationTests(fields));

    act(() => result.current.lidarrTest.run(clickEvent));

    await waitFor(() =>
      expect(result.current.lidarrTest.result).toEqual({
        success: true,
        version: "2.0",
      })
    );
    expect(mockTestConnection).toHaveBeenCalledWith(fields);
    expect(result.current.lidarrTest.testing).toBe(false);
  });

  it("reloads the option lists once Lidarr answers, not before", async () => {
    const { result } = renderHook(() => useIntegrationTests(fields));

    act(() => result.current.lidarrTest.run(clickEvent));

    await waitFor(() =>
      expect(mockLoadLidarrOptionValues).toHaveBeenCalledTimes(1)
    );
  });

  it("leaves the option lists alone when the test failed", async () => {
    mockTestConnection.mockResolvedValue({ success: false, error: "401" });
    const { result } = renderHook(() => useIntegrationTests(fields));

    act(() => result.current.lidarrTest.run(clickEvent));

    await waitFor(() =>
      expect(result.current.lidarrTest.result).toEqual({
        success: false,
        error: "401",
      })
    );
    expect(mockLoadLidarrOptionValues).not.toHaveBeenCalled();
  });

  it("turns a thrown Lidarr test into a failure result", async () => {
    mockTestConnection.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useIntegrationTests(fields));

    act(() => result.current.lidarrTest.run(clickEvent));

    await waitFor(() =>
      expect(result.current.lidarrTest.result).toEqual({
        success: false,
        error: "network down",
      })
    );
  });

  it("tests slskd independently of Lidarr", async () => {
    const { result } = renderHook(() => useIntegrationTests(fields));

    act(() => result.current.slskdTest.run(clickEvent));

    await waitFor(() =>
      expect(result.current.slskdTest.result).toEqual({
        success: true,
        soulseekConnected: true,
      })
    );
    expect(result.current.lidarrTest.result).toBeNull();
  });

  it("turns a thrown slskd test into a failure result", async () => {
    mockTestSlskdConnection.mockRejectedValue(new Error("refused"));
    const { result } = renderHook(() => useIntegrationTests(fields));

    act(() => result.current.slskdTest.run(clickEvent));

    await waitFor(() =>
      expect(result.current.slskdTest.result).toEqual({
        success: false,
        error: "refused",
      })
    );
  });

  it("clears a previous result when a test is re-run", async () => {
    mockTestConnection.mockResolvedValue({ success: false, error: "401" });
    const { result } = renderHook(() => useIntegrationTests(fields));

    act(() => result.current.lidarrTest.run(clickEvent));
    await waitFor(() =>
      expect(result.current.lidarrTest.result).not.toBeNull()
    );

    let resolveSecond: (value: unknown) => void = () => {};
    mockTestConnection.mockReturnValue(
      new Promise((resolve) => {
        resolveSecond = resolve;
      })
    );

    act(() => result.current.lidarrTest.run(clickEvent));

    expect(result.current.lidarrTest.result).toBeNull();
    expect(result.current.lidarrTest.testing).toBe(true);

    await act(async () => {
      resolveSecond({ success: true, version: "2.1" });
    });
  });
});
