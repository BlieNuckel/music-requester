import { renderHook, act, waitFor } from "@testing-library/react";
import usePurchaseList from "../usePurchaseList";

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
    price: 999,
    currency: "USD",
    purchasedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: 2,
    albumMbid: "mbid-2",
    artistName: "Bjork",
    albumTitle: "Homogenic",
    price: 1500,
    currency: "USD",
    purchasedAt: "2024-01-02T00:00:00Z",
  },
];

const mockSummary = { month: 2499, allTime: 2499, albumCount: 2 };

describe("usePurchaseList", () => {
  it("fetches purchases and summary on mount", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockItems), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockSummary), { status: 200 })
      );

    const { result } = renderHook(() => usePurchaseList());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toEqual(mockItems);
    expect(result.current.summary).toEqual(mockSummary);
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledWith("/api/purchases", {
      signal: expect.any(AbortSignal),
    });
    expect(fetch).toHaveBeenCalledWith("/api/purchases/summary", {
      signal: expect.any(AbortSignal),
    });
  });

  it("sets error on items fetch failure", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("Server error", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockSummary), { status: 200 })
      );

    const { result } = renderHook(() => usePurchaseList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to load purchases");
  });

  it("sets error on summary fetch failure", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockItems), { status: 200 })
      )
      .mockResolvedValueOnce(new Response("Server error", { status: 500 }));

    const { result } = renderHook(() => usePurchaseList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to load spending summary");
  });

  it("removes item from list optimistically", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockItems), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockSummary), { status: 200 })
      );

    const { result } = renderHook(() => usePurchaseList());

    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "removed" }), { status: 200 })
    );

    await act(() => result.current.removeItem("mbid-1"));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].albumMbid).toBe("mbid-2");
    expect(fetch).toHaveBeenCalledWith("/api/purchases/mbid-1", {
      method: "DELETE",
    });
  });

  it("does not remove item when delete fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockItems), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockSummary), { status: 200 })
      );

    const { result } = renderHook(() => usePurchaseList());

    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Not found", { status: 404 })
    );

    await act(() => result.current.removeItem("mbid-1"));

    expect(result.current.items).toHaveLength(2);
  });

  it("refreshes data", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ month: 0, allTime: 0, albumCount: 0 }), {
          status: 200,
        })
      );

    const { result } = renderHook(() => usePurchaseList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockItems), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockSummary), { status: 200 })
      );

    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refresh();
    });
    await act(async () => {
      await refreshPromise;
    });

    expect(result.current.items).toEqual(mockItems);
    expect(result.current.summary).toEqual(mockSummary);
  });
});
