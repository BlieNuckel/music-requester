import { renderHook, waitFor } from "@testing-library/react";
import useSimilarAlbums from "../useSimilarAlbums";

const loveless = {
  mbid: "mbv-loveless",
  title: "Loveless",
  artistName: "My Bloody Valentine",
  artistMbid: "mbv-mbid",
  year: "1991",
  score: 0.8,
  reasons: ["tag", "artist"],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSimilarAlbums", () => {
  it("does not fetch until an album mbid is known", () => {
    const { result } = renderHook(() => useSimilarAlbums(null));

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.albums).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("shapes the response as release groups the album card can render", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ albums: [loveless] }), { status: 200 })
    );

    const { result } = renderHook(() => useSimilarAlbums("seed-rg"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.albums).toEqual([
      {
        id: "mbv-loveless",
        score: 0.8,
        title: "Loveless",
        "primary-type": "Album",
        "first-release-date": "1991",
        "artist-credit": [
          {
            name: "My Bloody Valentine",
            artist: { id: "mbv-mbid", name: "My Bloody Valentine" },
          },
        ],
      },
    ]);
  });

  it("encodes the mbid into the request", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ albums: [] }), { status: 200 })
    );

    const { result } = renderHook(() => useSimilarAlbums("seed rg"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "/api/similar-albums?mbid=seed%20rg"
    );
  });

  it("sets an error when the request fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 500 })
    );

    const { result } = renderHook(() => useSimilarAlbums("seed-rg"));

    await waitFor(() =>
      expect(result.current.error).toBe("Failed to load similar albums")
    );
    expect(result.current.albums).toEqual([]);
  });

  it("surfaces the server's error message when it sends one", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "mbid query parameter is required" }),
        {
          status: 400,
        }
      )
    );

    const { result } = renderHook(() => useSimilarAlbums("seed-rg"));

    await waitFor(() =>
      expect(result.current.error).toBe("mbid query parameter is required")
    );
  });
});
