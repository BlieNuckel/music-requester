import { renderHook, act, waitFor } from "@testing-library/react";
import useWantedList from "../useWantedList";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

const mockItems = [
  {
    id: 1,
    albumMbid: "mbid-1",
    artistName: "Radiohead",
    albumTitle: "OK Computer",
    createdAt: "2024-01-01T00:00:00Z",
  },
  {
    id: 2,
    albumMbid: "mbid-2",
    artistName: "Bjork",
    albumTitle: "Homogenic",
    createdAt: "2024-01-02T00:00:00Z",
  },
];

describe("useWantedList", () => {
  it("fetches wanted items on mount", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockItems), { status: 200 })
    );

    const { result } = renderHook(() => useWantedList());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toEqual(mockItems);
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledWith("/api/wanted", {
      signal: expect.any(AbortSignal),
    });
  });

  it("sets error on fetch failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Server error", { status: 500 })
    );

    const { result } = renderHook(() => useWantedList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to load wanted list");
    expect(result.current.items).toEqual([]);
  });

  it("removes item from list optimistically", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockItems), { status: 200 })
    );

    const { result } = renderHook(() => useWantedList());

    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "removed" }), { status: 200 })
    );

    await act(() => result.current.removeItem("mbid-1"));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].albumMbid).toBe("mbid-2");
    expect(fetch).toHaveBeenCalledWith("/api/wanted/mbid-1", {
      method: "DELETE",
    });
  });

  it("does not remove item when delete fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockItems), { status: 200 })
    );

    const { result } = renderHook(() => useWantedList());

    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Not found", { status: 404 })
    );

    await act(() => result.current.removeItem("mbid-1"));

    expect(result.current.items).toHaveLength(2);
  });

  it("refreshes the list", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    const { result } = renderHook(() => useWantedList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockItems), { status: 200 })
    );

    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refresh();
    });
    await act(async () => {
      await refreshPromise;
    });

    expect(result.current.items).toEqual(mockItems);
  });
});
