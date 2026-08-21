import { renderHook, act } from "@testing-library/react";
import useFileUpload from "../useFileUpload";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useFileUpload", () => {
  it("has correct initial state", () => {
    const { result } = renderHook(() => useFileUpload());

    expect(result.current.step).toBe("idle");
    expect(result.current.files).toEqual([]);
    expect(result.current.uploadId).toBeNull();
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("adds files", () => {
    const { result } = renderHook(() => useFileUpload());
    const file = new File(["audio"], "track.flac", { type: "audio/flac" });

    act(() => {
      result.current.addFiles([file]);
    });

    expect(result.current.files).toHaveLength(1);
    expect(result.current.files[0].file).toBe(file);
    expect(result.current.files[0].status).toBe("pending");
  });

  it("removes files by index", () => {
    const { result } = renderHook(() => useFileUpload());
    const file1 = new File(["a"], "a.flac");
    const file2 = new File(["b"], "b.flac");

    act(() => {
      result.current.addFiles([file1, file2]);
    });

    act(() => {
      result.current.removeFile(0);
    });

    expect(result.current.files).toHaveLength(1);
    expect(result.current.files[0].file).toBe(file2);
  });

  it("resets to initial state", () => {
    const { result } = renderHook(() => useFileUpload());
    const file = new File(["a"], "a.flac");

    act(() => {
      result.current.addFiles([file]);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.step).toBe("idle");
    expect(result.current.files).toEqual([]);
  });

  it("uploads files and scans on success", async () => {
    let uploadCallCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("upload-file")) {
        uploadCallCount++;
        return new Response(JSON.stringify({ uploadId: "uuid-1" }), {
          status: 200,
        });
      }
      if (urlStr.includes("/scan")) {
        return new Response(
          JSON.stringify({
            artistId: 1,
            albumId: 10,
            items: [{ name: "track.flac", rejections: [] }],
          }),
          { status: 200 }
        );
      }
      return new Response("", { status: 404 });
    });

    const { result } = renderHook(() => useFileUpload());

    act(() => {
      result.current.addFiles([
        new File(["a"], "a.flac"),
        new File(["b"], "b.flac"),
      ]);
    });

    await act(async () => {
      await result.current.startUpload("mbid-1", "OK Computer");
    });

    expect(uploadCallCount).toBe(2);
    expect(result.current.step).toBe("reviewing");
    expect(result.current.items).toHaveLength(1);
  });

  it("handles upload error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Server error" }), { status: 500 })
    );

    const { result } = renderHook(() => useFileUpload());

    act(() => {
      result.current.addFiles([new File(["a"], "a.flac")]);
    });

    await act(async () => {
      await result.current.startUpload("mbid-1", "Test Album");
    });

    expect(result.current.step).toBe("error");
    expect(result.current.error).toBe("Server error");
  });

  it("confirms import", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "success", pending: false }), {
        status: 200,
      })
    );

    const { result } = renderHook(() => useFileUpload());

    await act(async () => {
      await result.current.confirm([]);
    });

    expect(result.current.step).toBe("done");
    expect(result.current.pending).toBe(false);
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({
      items: [],
      uploadId: null,
    });
  });

  it("reports that Lidarr is still importing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "success", pending: true }), {
        status: 200,
      })
    );

    const { result } = renderHook(() => useFileUpload());

    await act(async () => {
      await result.current.confirm([]);
    });

    expect(result.current.step).toBe("done");
    expect(result.current.pending).toBe(true);
  });

  it("surfaces the files Lidarr refused", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Lidarr could not match every file to a track.",
          files: [
            {
              path: "/imports/album/mystery.flac",
              reason: "Lidarr could not determine: track match",
            },
          ],
        }),
        { status: 400 }
      )
    );

    const { result } = renderHook(() => useFileUpload());

    await act(async () => {
      await result.current.confirm([]);
    });

    expect(result.current.step).toBe("error");
    expect(result.current.error).toContain("could not match every file");
    expect(result.current.error).toContain(
      "mystery.flac: Lidarr could not determine: track match"
    );
  });

  it("cancels and cleans up", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));

    const { result } = renderHook(() => useFileUpload());

    await act(async () => {
      await result.current.cancel();
    });

    expect(result.current.step).toBe("idle");
    expect(result.current.files).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sets error when no files selected", async () => {
    const { result } = renderHook(() => useFileUpload());

    await act(async () => {
      await result.current.startUpload("mbid-1", "Test Album");
    });

    expect(result.current.step).toBe("error");
    expect(result.current.error).toBe("No files selected");
  });
});
