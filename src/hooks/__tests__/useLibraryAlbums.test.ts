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

  describe("getTrackAvailability", () => {
    it("returns available and total track counts from statistics", async () => {
      const albums = [
        {
          id: 1,
          title: "OK Computer",
          foreignAlbumId: "rg-1",
          monitored: true,
          statistics: {
            trackFileCount: 9,
            totalTrackCount: 12,
            percentOfTracks: 75,
          },
        },
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

      expect(result.current.getTrackAvailability("rg-1")).toEqual({
        available: 9,
        total: 12,
      });
    });

    it("returns null when the album has no statistics", async () => {
      const albums = [
        { id: 1, title: "Kid A", foreignAlbumId: "rg-2", monitored: true },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(albums), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const { result } = renderHook(() => useLibraryAlbums());

      await waitFor(() => {
        expect(result.current.isAlbumInLibrary("rg-2")).toBe(true);
      });

      expect(result.current.getTrackAvailability("rg-2")).toBeNull();
    });

    it("returns null when total track count is zero", async () => {
      const albums = [
        {
          id: 1,
          title: "Empty",
          foreignAlbumId: "rg-3",
          monitored: true,
          statistics: {
            trackFileCount: 0,
            totalTrackCount: 0,
            percentOfTracks: 0,
          },
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(albums), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const { result } = renderHook(() => useLibraryAlbums());

      await waitFor(() => {
        expect(result.current.isAlbumInLibrary("rg-3")).toBe(true);
      });

      expect(result.current.getTrackAvailability("rg-3")).toBeNull();
    });

    it("returns null for albums not in the library", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const { result } = renderHook(() => useLibraryAlbums());

      await waitFor(() => {
        expect(fetch).toHaveBeenCalled();
      });

      expect(result.current.getTrackAvailability("rg-unknown")).toBeNull();
    });
  });
});
