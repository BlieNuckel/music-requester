import { renderHook, act } from "@testing-library/react";
import { useAutoSave } from "../useAutoSave";
import type { AppSettings } from "@/context/settingsContextDef";

const defaultSettings: AppSettings = {
  lidarrUrl: "http://lidarr:8686",
  lidarrApiKey: "key1",
  lidarrQualityProfileId: 1,
  lidarrRootFolderPath: "/music",
  lidarrMetadataProfileId: 1,
  lastfmApiKey: "lfm-key",
  plexUrl: "http://plex:32400",
  importPath: "/imports",
  slskdUrl: "",
  slskdApiKey: "",
  slskdDownloadPath: "",
  torznabApiKey: "",
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAutoSave", () => {
  it("initializes fields from settings", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(defaultSettings, save));

    expect(result.current.fields).toEqual(defaultSettings);
    expect(result.current.saveStatus).toBe("idle");
  });

  it("updates local field immediately on updateField", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(defaultSettings, save));

    act(() => {
      result.current.updateField("lidarrUrl", "http://new-url");
    });

    expect(result.current.fields.lidarrUrl).toBe("http://new-url");
  });

  it("debounces text field saves", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(defaultSettings, save));

    act(() => {
      result.current.updateField("lidarrUrl", "http://new-url");
    });

    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(save).toHaveBeenCalledWith({ lidarrUrl: "http://new-url" });
  });

  it("saves dropdown fields immediately", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(defaultSettings, save));

    await act(async () => {
      result.current.updateField("lidarrQualityProfileId", 3);
    });

    expect(save).toHaveBeenCalledWith({ lidarrQualityProfileId: 3 });
  });

  it("resets debounce when same field updated rapidly", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(defaultSettings, save));

    act(() => {
      result.current.updateField("lidarrUrl", "http://a");
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    act(() => {
      result.current.updateField("lidarrUrl", "http://ab");
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ lidarrUrl: "http://ab" });
  });

  it("tracks saving status", async () => {
    let resolveSave: () => void;
    const save = vi.fn(
      () => new Promise<void>((resolve) => (resolveSave = resolve))
    );
    const { result } = renderHook(() => useAutoSave(defaultSettings, save));

    await act(async () => {
      result.current.updateField("lidarrQualityProfileId", 2);
    });

    expect(result.current.saveStatus).toBe("saving");

    await act(async () => {
      resolveSave!();
    });

    expect(result.current.saveStatus).toBe("saved");

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.saveStatus).toBe("idle");
  });

  it("tracks error status", async () => {
    const save = vi.fn().mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useAutoSave(defaultSettings, save));

    await act(async () => {
      result.current.updateField("lidarrQualityProfileId", 2);
    });

    expect(result.current.saveStatus).toBe("error");
    expect(result.current.saveError).toBe("Network error");
  });

  it("updateFields saves multiple fields immediately", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(defaultSettings, save));

    await act(async () => {
      result.current.updateFields({
        plexUrl: "http://new-plex",
        lastfmApiKey: "new-key",
      });
    });

    expect(save).toHaveBeenCalledWith({
      plexUrl: "http://new-plex",
      lastfmApiKey: "new-key",
    });
    expect(result.current.fields.plexUrl).toBe("http://new-plex");
    expect(result.current.fields.lastfmApiKey).toBe("new-key");
  });

  it("syncs fields when settings prop changes", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ settings }) => useAutoSave(settings, save),
      { initialProps: { settings: defaultSettings } }
    );

    const updated = { ...defaultSettings, lastfmApiKey: "new-key" };
    rerender({ settings: updated });

    expect(result.current.fields.lastfmApiKey).toBe("new-key");
  });
});
