import { renderHook, act, waitFor } from "@testing-library/react";
import usePromotedAlbums from "../usePromotedAlbums";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

const albums = [
  {
    album: {
      name: "OK Computer",
      mbid: "alb-1",
      artistName: "Radiohead",
      artistMbid: "art-1",
      coverUrl: "https://coverartarchive.org/release-group/alb-1/front-500",
      year: "1997",
    },
    tag: "alternative",
    inLibrary: false,
  },
  {
    album: {
      name: "Homogenic",
      mbid: "alb-2",
      artistName: "Bjork",
      artistMbid: "art-2",
      coverUrl: "https://coverartarchive.org/release-group/alb-2/front-500",
      year: "1997",
    },
    tag: "trip hop",
    inLibrary: false,
  },
];

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("usePromotedAlbums", () => {
  it("has correct initial state", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => usePromotedAlbums());
    expect(result.current.promotedAlbums).toEqual([]);
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("fetches promoted albums on mount", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ status: "ready", albums })
    );

    const { result } = renderHook(() => usePromotedAlbums());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.promotedAlbums).toEqual(albums);
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledWith("/api/promoted-album", {
      signal: expect.any(AbortSignal),
    });
  });

  it("handles an empty list", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ status: "ready", albums: [] })
    );

    const { result } = renderHook(() => usePromotedAlbums());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.promotedAlbums).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("reports building until the server has a profile", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ status: "building", albums: [] })
    );

    const { result } = renderHook(() => usePromotedAlbums());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.building).toBe(true);
    expect(result.current.promotedAlbums).toEqual([]);
  });

  it("normalizes a malformed response to an empty ready list", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(null));

    const { result } = renderHook(() => usePromotedAlbums());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.promotedAlbums).toEqual([]);
  });

  it("sets error on failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Server error" }), { status: 500 })
    );

    const { result } = renderHook(() => usePromotedAlbums());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to fetch promoted albums");
    expect(result.current.promotedAlbums).toEqual([]);
  });

  it("handles network error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network failure"));

    const { result } = renderHook(() => usePromotedAlbums());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Network failure");
    expect(result.current.promotedAlbums).toEqual([]);
  });

  it("refresh calls with refresh param", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ status: "ready", albums })
    );

    const { result } = renderHook(() => usePromotedAlbums());

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

    expect(fetch).toHaveBeenCalledWith("/api/promoted-album?refresh=true", {
      signal: expect.any(AbortSignal),
    });
  });
});
