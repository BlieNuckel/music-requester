import { renderHook, waitFor } from "@testing-library/react";
import useLibraryAlbums from "../useLibraryAlbums";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useLibraryAlbums", () => {
  it("returns false when no library albums loaded", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { result } = renderHook(() => useLibraryAlbums());

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/lidarr/albums");
    });

    expect(result.current.isAlbumInLibrary("some-mbid")).toBe(false);
  });

  it("identifies albums in library by foreignAlbumId", async () => {
    const albums = [
      { id: 1, title: "OK Computer", foreignAlbumId: "rg-1", monitored: true },
      { id: 2, title: "Kid A", foreignAlbumId: "rg-2", monitored: true },
    ];

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(albums), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { result } = renderHook(() => useLibraryAlbums());

    await waitFor(() => {
      expect(result.current.isAlbumInLibrary("rg-1")).toBe(true);
    });

    expect(result.current.isAlbumInLibrary("rg-2")).toBe(true);
    expect(result.current.isAlbumInLibrary("rg-unknown")).toBe(false);
  });

  it("handles fetch failure gracefully", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useLibraryAlbums());

    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });

    expect(result.current.isAlbumInLibrary("any-mbid")).toBe(false);
  });

  it("handles non-ok response gracefully", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    const { result } = renderHook(() => useLibraryAlbums());

    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });

    expect(result.current.isAlbumInLibrary("any-mbid")).toBe(false);
  });

  describe("getAlbumLibrary", () => {
    const renderWithAlbums = async (albums: unknown[]) => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(albums), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const { result } = renderHook(() => useLibraryAlbums());

      await waitFor(() => {
        expect(fetch).toHaveBeenCalled();
      });

      return result;
    };

    it("reports complete when every track has a file", async () => {
      const result = await renderWithAlbums([
        {
          id: 1,
          title: "OK Computer",
          foreignAlbumId: "rg-1",
          monitored: true,
          statistics: {
            trackFileCount: 12,
            totalTrackCount: 12,
            percentOfTracks: 100,
          },
        },
      ]);

      await waitFor(() => {
        expect(result.current.getAlbumLibrary("rg-1")).toEqual({
          state: "complete",
          available: 12,
          total: 12,
        });
      });
    });

    it("reports partial when some tracks are missing", async () => {
      const result = await renderWithAlbums([
        {
          id: 1,
          title: "Kid A",
          foreignAlbumId: "rg-2",
          monitored: true,
          statistics: {
            trackFileCount: 9,
            totalTrackCount: 12,
            percentOfTracks: 75,
          },
        },
      ]);

      await waitFor(() => {
        expect(result.current.getAlbumLibrary("rg-2")).toEqual({
          state: "partial",
          available: 9,
          total: 12,
        });
      });
    });

    it("reports requested for a monitored album with no files", async () => {
      const result = await renderWithAlbums([
        {
          id: 1,
          title: "Kauai",
          foreignAlbumId: "rg-3",
          monitored: true,
          statistics: {
            trackFileCount: 0,
            totalTrackCount: 7,
            percentOfTracks: 0,
          },
        },
      ]);

      await waitFor(() => {
        expect(result.current.getAlbumLibrary("rg-3")).toEqual({
          state: "requested",
          available: 0,
          total: 7,
        });
      });
    });

    it("reports requested when the album has no statistics yet", async () => {
      const result = await renderWithAlbums([
        { id: 1, title: "Fresh", foreignAlbumId: "rg-4", monitored: true },
      ]);

      await waitFor(() => {
        expect(result.current.getAlbumLibrary("rg-4")?.state).toBe("requested");
      });
    });

    it("returns null for albums not in the library", async () => {
      const result = await renderWithAlbums([]);

      expect(result.current.getAlbumLibrary("rg-unknown")).toBeNull();
    });
  });
});
