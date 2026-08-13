import { renderHook, waitFor, act } from "@testing-library/react";
import { useRequests } from "../useRequests";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

const mockRequest = {
  id: 1,
  albumMbid: "abc-123",
  artistName: "Radiohead",
  albumTitle: "OK Computer",
  status: "pending",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  approvedAt: null,
  user: { id: 1, username: "testuser", thumb: null },
};

describe("useRequests", () => {
  it("fetches requests on mount", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify([mockRequest]), { status: 200 })
    );

    const { result } = renderHook(() => useRequests());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.requests).toHaveLength(1);
    expect(result.current.requests[0].albumTitle).toBe("OK Computer");
    expect(result.current.error).toBeNull();
  });

  it("passes userId as query param", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 })
    );

    renderHook(() => useRequests({ userId: 42 }));

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/requests?userId=42", {
        signal: expect.any(AbortSignal),
      });
    });
  });

  it("handles fetch error", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useRequests());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Network error");
    expect(result.current.requests).toHaveLength(0);
  });

  it("handles non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 500 }));

    const { result } = renderHook(() => useRequests());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to fetch requests");
  });

  it("approves a request optimistically", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([mockRequest]), { status: 200 })
    );

    const { result } = renderHook(() => useRequests());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "approved" }), { status: 200 })
    );

    await act(() => result.current.approveRequest(1));

    expect(result.current.requests[0].status).toBe("approved");
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/requests/1/approve", {
      method: "POST",
    });
  });

  it("declines a request optimistically", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([mockRequest]), { status: 200 })
    );

    const { result } = renderHook(() => useRequests());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "declined" }), { status: 200 })
    );

    await act(() => result.current.declineRequest(1));

    expect(result.current.requests[0].status).toBe("declined");
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/requests/1/decline", {
      method: "POST",
    });
  });

  it("refreshes requests", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify([mockRequest]), { status: 200 })
    );

    const { result } = renderHook(() => useRequests());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const callCount = vi.mocked(fetch).mock.calls.length;
    await result.current.refresh();

    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(callCount);
  });
});
