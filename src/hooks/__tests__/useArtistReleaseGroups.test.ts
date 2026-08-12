import { renderHook, waitFor } from "@testing-library/react";
import useArtistReleaseGroups from "../useArtistReleaseGroups";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useArtistReleaseGroups", () => {
  it("does not fetch when no artist mbid is known yet", () => {
    const { result } = renderHook(() => useArtistReleaseGroups(null));
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.releaseGroups).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("loads the artist's release groups", async () => {
    const payload = { releaseGroups: [{ id: "rg-1", title: "OK Computer" }] };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(payload), { status: 200 })
    );

    const { result } = renderHook(() => useArtistReleaseGroups("a1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.releaseGroups).toEqual(payload.releaseGroups);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "/api/musicbrainz/artist/a1/release-groups"
    );
  });

  it("sets an error when the request fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 500 })
    );

    const { result } = renderHook(() => useArtistReleaseGroups("a1"));

    await waitFor(() =>
      expect(result.current.error).toBe("Failed to load discography")
    );
    expect(result.current.releaseGroups).toEqual([]);
  });
});
