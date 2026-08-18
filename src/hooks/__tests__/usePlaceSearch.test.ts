import { renderHook, act, waitFor } from "@testing-library/react";
import usePlaceSearch from "../usePlaceSearch";

const mockFetch = vi.fn();

const MALMO = {
  name: "Malmö",
  region: "Skåne County",
  country: "Sweden",
  countryCode: "SE",
  latitude: 55.6059,
  longitude: 13.0007,
  population: 362133,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePlaceSearch", () => {
  it("starts with nothing searched yet", () => {
    const { result } = renderHook(() => usePlaceSearch());

    expect(result.current.places).toBeNull();
    expect(result.current.searching).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("looks a place up and exposes the matches", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ places: [MALMO] }),
    });

    const { result } = renderHook(() => usePlaceSearch());
    await act(() => result.current.search("Malmö"));

    expect(mockFetch).toHaveBeenCalledWith("/api/live/geocode?q=Malm%C3%B6");
    expect(result.current.places).toEqual([MALMO]);
  });

  it("trims the query before sending it", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ places: [] }),
    });

    const { result } = renderHook(() => usePlaceSearch());
    await act(() => result.current.search("  Lund  "));

    expect(mockFetch).toHaveBeenCalledWith("/api/live/geocode?q=Lund");
  });

  it("distinguishes no matches from not having searched", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ places: [] }),
    });

    const { result } = renderHook(() => usePlaceSearch());
    await act(() => result.current.search("Nowherecity"));

    expect(result.current.places).toEqual([]);
  });

  it("does not call out for a query too short to be a place", async () => {
    const { result } = renderHook(() => usePlaceSearch());
    await act(() => result.current.search("m"));

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.places).toBeNull();
  });

  it("surfaces a failed lookup", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const { result } = renderHook(() => usePlaceSearch());
    await act(() => result.current.search("Malmö"));

    expect(result.current.error).toBe("Could not look that place up.");
    expect(result.current.places).toBeNull();
  });

  it("surfaces a network failure the same way", async () => {
    mockFetch.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => usePlaceSearch());
    await act(() => result.current.search("Malmö"));

    expect(result.current.error).toBe("Could not look that place up.");
  });

  it("clears results so a picked place does not leave a list open", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ places: [MALMO] }),
    });

    const { result } = renderHook(() => usePlaceSearch());
    await act(() => result.current.search("Malmö"));
    act(() => result.current.clear());

    await waitFor(() => expect(result.current.places).toBeNull());
  });
});
