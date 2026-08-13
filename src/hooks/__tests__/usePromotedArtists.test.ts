import { renderHook, act, waitFor } from "@testing-library/react";
import usePromotedArtists from "../usePromotedArtists";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

const artistsData = {
  artists: [
    {
      name: "Boards of Canada",
      mbid: "boc-1",
      imageUrl: "https://example.com/boc.jpg",
      match: 0.82,
      inLibrary: false,
    },
  ],
  seedArtists: ["Aphex Twin"],
};

describe("usePromotedArtists", () => {
  it("has correct initial state", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => usePromotedArtists());
    expect(result.current.promotedArtists).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("fetches promoted artists on mount", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(artistsData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { result } = renderHook(() => usePromotedArtists());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.promotedArtists).toEqual(artistsData);
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledWith("/api/promoted-artists", {
      signal: expect.any(AbortSignal),
    });
  });

  it("handles null response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(null), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { result } = renderHook(() => usePromotedArtists());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.promotedArtists).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("sets error on failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Server error" }), { status: 500 })
    );

    const { result } = renderHook(() => usePromotedArtists());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to fetch promoted artists");
    expect(result.current.promotedArtists).toBeNull();
  });

  it("handles network error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network failure"));

    const { result } = renderHook(() => usePromotedArtists());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Network failure");
    expect(result.current.promotedArtists).toBeNull();
  });

  it("refresh calls with refresh param", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(artistsData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { result } = renderHook(() => usePromotedArtists());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refresh();
    });
    await act(async () => {
      await refreshPromise;
    });

    expect(fetch).toHaveBeenCalledWith("/api/promoted-artists?refresh=true", {
      signal: expect.any(AbortSignal),
    });
  });
});
