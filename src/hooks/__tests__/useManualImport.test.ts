import { renderHook, act } from "@testing-library/react";
import useManualImport from "../useManualImport";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeFileList(names: string[]): FileList {
  const files = names.map(
    (name) => new File(["content"], name, { type: "audio/flac" })
  );
  return Object.assign(files, {
    item: (i: number) => files[i] ?? null,
    [Symbol.iterator]: files[Symbol.iterator].bind(files),
  }) as unknown as FileList;
}

describe("useManualImport", () => {
  it("has correct initial state", () => {
    const { result } = renderHook(() => useManualImport());
    expect(result.current.step).toBe("idle");
    expect(result.current.uploadId).toBeNull();
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("upload transitions to reviewing on success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          uploadId: "upload-1",
          artistId: 10,
          albumId: 20,
          items: [{ name: "track.flac" }],
        }),
        { status: 200 }
      )
    );

    const { result } = renderHook(() => useManualImport());
    await act(() =>
      result.current.upload(makeFileList(["track.flac"]), "mbid-123")
    );

    expect(result.current.step).toBe("reviewing");
    expect(result.current.uploadId).toBe("upload-1");
    expect(result.current.items).toEqual([{ name: "track.flac" }]);
  });

  it("upload transitions to error on failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Bad request" }), { status: 400 })
    );

    const { result } = renderHook(() => useManualImport());
    await act(() =>
      result.current.upload(makeFileList(["track.flac"]), "mbid-123")
    );

    expect(result.current.step).toBe("error");
    expect(result.current.error).toBe("Bad request");
  });

  it("upload handles non-JSON response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Gateway Timeout", { status: 504 })
    );

    const { result } = renderHook(() => useManualImport());
    await act(() =>
      result.current.upload(makeFileList(["track.flac"]), "mbid-123")
    );

    expect(result.current.step).toBe("error");
    expect(result.current.error).toBe("Gateway Timeout");
  });

  it("confirm transitions to done on success", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            uploadId: "u1",
            artistId: 1,
            albumId: 1,
            items: [],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

    const { result } = renderHook(() => useManualImport());
    await act(() => result.current.upload(makeFileList(["t.flac"]), "mbid"));
    await act(() => result.current.confirm([]));

    expect(result.current.step).toBe("done");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toEqual(
      { items: [], uploadId: "u1" }
    );
  });

  it("confirm transitions to error on failure", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            uploadId: "u1",
            artistId: 1,
            albumId: 1,
            items: [],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Import failed" }), {
          status: 500,
        })
      );

    const { result } = renderHook(() => useManualImport());
    await act(() => result.current.upload(makeFileList(["t.flac"]), "mbid"));
    await act(() => result.current.confirm([]));

    expect(result.current.step).toBe("error");
    expect(result.current.error).toBe("Import failed");
  });

  it("cancel calls DELETE when uploadId exists", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            uploadId: "u1",
            artistId: 1,
            albumId: 1,
            items: [],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response("", { status: 200 }));

    const { result } = renderHook(() => useManualImport());
    await act(() => result.current.upload(makeFileList(["t.flac"]), "mbid"));
    await act(() => result.current.cancel());

    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/lidarr/import/u1", {
      method: "DELETE",
    });
    expect(result.current.step).toBe("idle");
  });

  it("cancel skips DELETE when no uploadId", async () => {
    const { result } = renderHook(() => useManualImport());
    await act(() => result.current.cancel());

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.step).toBe("idle");
  });

  it("reset returns to initial state", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          uploadId: "u1",
          artistId: 1,
          albumId: 1,
          items: [{ name: "f" }],
        }),
        { status: 200 }
      )
    );

    const { result } = renderHook(() => useManualImport());
    await act(() => result.current.upload(makeFileList(["t.flac"]), "mbid"));
    expect(result.current.step).toBe("reviewing");

    act(() => result.current.reset());
    expect(result.current.step).toBe("idle");
    expect(result.current.uploadId).toBeNull();
    expect(result.current.items).toEqual([]);
  });
});
