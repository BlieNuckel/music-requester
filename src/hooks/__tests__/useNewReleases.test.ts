import { renderHook, waitFor } from "@testing-library/react";
import useNewReleases from "../useNewReleases";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useNewReleases", () => {
  it("fetches and exposes new releases", async () => {
    const payload = { items: [], windowDays: 90 };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    });

    const { result } = renderHook(() => useNewReleases());
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.newReleases).toEqual(payload);
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith("/api/discover/new-releases");
  });

  it("exposes an error on failure", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const { result } = renderHook(() => useNewReleases());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to fetch new releases");
    expect(result.current.newReleases).toBeNull();
  });
});
