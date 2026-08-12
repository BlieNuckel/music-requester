import { renderHook, waitFor } from "@testing-library/react";
import useArtistDetails from "../useArtistDetails";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useArtistDetails", () => {
  it("does not fetch when no mbid is provided", () => {
    const { result } = renderHook(() => useArtistDetails(undefined));
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.artist).toBeNull();
  });

  it("loads artist details", async () => {
    const payload = { artist: { mbid: "a1", name: "Radiohead" } };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(payload), { status: 200 })
    );

    const { result } = renderHook(() => useArtistDetails("a1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.artist).toEqual(payload.artist);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "/api/musicbrainz/artist/a1"
    );
  });

  it("sets an error when the request fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Artist not found" }), {
        status: 404,
      })
    );

    const { result } = renderHook(() => useArtistDetails("missing"));

    await waitFor(() => expect(result.current.error).toBe("Artist not found"));
    expect(result.current.artist).toBeNull();
  });
});
