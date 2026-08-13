import { renderHook, waitFor } from "@testing-library/react";
import useSimilarArtists from "../useSimilarArtists";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

const response = {
  artists: [
    { name: "Muse", mbid: "muse-1", imageUrl: "m.jpg", match: 0.9 },
    { name: "Coldplay", mbid: "cold-1", imageUrl: "c.jpg", match: 0.8 },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("useSimilarArtists", () => {
  it("does not fetch without an artist name", () => {
    renderHook(() => useSimilarArtists(undefined));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches similar artists for the given name", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(response));

    const { result } = renderHook(() => useSimilarArtists("Radiohead"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetch).toHaveBeenCalledWith("/api/lastfm/similar?artist=Radiohead", {
      signal: expect.any(AbortSignal),
    });
    expect(result.current.artists).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it("filters out the excluded mbid (self-match)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(response));

    const { result } = renderHook(() =>
      useSimilarArtists("Radiohead", "muse-1")
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.artists.map((a) => a.mbid)).toEqual(["cold-1"]);
  });

  it("caps the list at the top 10 artists", async () => {
    const many = {
      artists: Array.from({ length: 15 }, (_, i) => ({
        name: `Artist ${i}`,
        mbid: `mbid-${i}`,
        imageUrl: "",
        match: 1 - i / 100,
      })),
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(many));

    const { result } = renderHook(() => useSimilarArtists("Radiohead"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.artists).toHaveLength(10);
    expect(result.current.artists[0].mbid).toBe("mbid-0");
  });

  it("sets an error when the request fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: "x" }, 500));

    const { result } = renderHook(() => useSimilarArtists("Radiohead"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch similar artists");
    expect(result.current.artists).toEqual([]);
  });

  it("handles a network error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network failure"));

    const { result } = renderHook(() => useSimilarArtists("Radiohead"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Network failure");
    expect(result.current.artists).toEqual([]);
  });
});
