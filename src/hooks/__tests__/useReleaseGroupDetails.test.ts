import { renderHook, waitFor } from "@testing-library/react";
import useReleaseGroupDetails from "../useReleaseGroupDetails";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useReleaseGroupDetails", () => {
  it("does not fetch when no mbid is provided", () => {
    const { result } = renderHook(() => useReleaseGroupDetails(undefined));
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.album).toBeNull();
  });

  it("loads album details", async () => {
    const payload = {
      album: {
        mbid: "rg-1",
        title: "OK Computer",
        artistName: "Radiohead",
        artistMbid: "a1",
        firstReleaseDate: "1997-06-16",
        primaryType: "Album",
        secondaryTypes: [],
      },
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(payload), { status: 200 })
    );

    const { result } = renderHook(() => useReleaseGroupDetails("rg-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.album).toEqual(payload.album);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "/api/musicbrainz/album/rg-1"
    );
  });

  it("sets an error when the request fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Album not found" }), {
        status: 404,
      })
    );

    const { result } = renderHook(() => useReleaseGroupDetails("missing"));

    await waitFor(() => expect(result.current.error).toBe("Album not found"));
    expect(result.current.album).toBeNull();
  });
});
