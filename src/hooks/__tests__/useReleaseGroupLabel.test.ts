import { renderHook, waitFor } from "@testing-library/react";
import useReleaseGroupLabel from "../useReleaseGroupLabel";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useReleaseGroupLabel", () => {
  it("does not fetch when no mbid is provided", () => {
    const { result } = renderHook(() => useReleaseGroupLabel(undefined));
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.label).toBeNull();
  });

  it("loads the label for a release group", async () => {
    const payload = { label: { name: "Parlophone", mbid: "label-1" } };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(payload), { status: 200 })
    );

    const { result } = renderHook(() => useReleaseGroupLabel("rg-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.label).toEqual(payload.label);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "/api/musicbrainz/release-group/rg-1/label"
    );
  });

  it("keeps the label null when the request fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("", { status: 500 }));

    const { result } = renderHook(() => useReleaseGroupLabel("rg-1"));

    await waitFor(() =>
      expect(result.current.error).toBe("Failed to load label")
    );
    expect(result.current.label).toBeNull();
  });
});
