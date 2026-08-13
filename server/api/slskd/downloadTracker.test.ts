import { beforeEach, describe, expect, it } from "vitest";

import type { TrackedDownload } from "./types.js";

import {
  addDownload,
  clearDownloads,
  getAllDownloads,
  getDownload,
  removeDownload,
} from "./downloadTracker.js";

function createDownload(
  overrides: Partial<TrackedDownload> = {}
): TrackedDownload {
  return {
    nzoId: "nzo-1",
    title: "Test Album",
    category: "music",
    username: "user1",
    files: [{ filename: "track01.flac", size: 50_000_000 }],
    totalSize: 50_000_000,
    addedAt: Date.now(),
    ...overrides,
  };
}

describe("downloadTracker", () => {
  beforeEach(() => {
    clearDownloads();
  });

  it("stores a download retrievable by nzoId", () => {
    const download = createDownload();
    addDownload(download);

    expect(getDownload("nzo-1")).toEqual(download);
  });

  it("returns undefined for an unknown nzoId", () => {
    expect(getDownload("nonexistent")).toBeUndefined();
  });

  it("returns all added downloads", () => {
    const a = createDownload({ nzoId: "nzo-a", title: "Album A" });
    const b = createDownload({ nzoId: "nzo-b", title: "Album B" });
    addDownload(a);
    addDownload(b);

    const all = getAllDownloads();
    expect(all).toHaveLength(2);
    expect(all).toEqual(expect.arrayContaining([a, b]));
  });

  it("removes a download and returns true", () => {
    addDownload(createDownload());

    expect(removeDownload("nzo-1")).toBe(true);
    expect(getDownload("nzo-1")).toBeUndefined();
  });

  it("returns false when removing an unknown nzoId", () => {
    expect(removeDownload("nonexistent")).toBe(false);
  });

  it("clears all downloads", () => {
    addDownload(createDownload({ nzoId: "nzo-a" }));
    addDownload(createDownload({ nzoId: "nzo-b" }));
    clearDownloads();

    expect(getAllDownloads()).toHaveLength(0);
  });

  describe("stale pruning", () => {
    const DAY_MS = 24 * 60 * 60 * 1000;

    it("stops reporting a download Lidarr never cleaned up", () => {
      const base = 1_700_000_000_000;
      addDownload(createDownload({ nzoId: "abandoned", addedAt: base }));

      expect(getAllDownloads(base + DAY_MS + 1)).toHaveLength(0);
    });

    it("keeps a download that is still within the retention window", () => {
      const base = 1_700_000_000_000;
      addDownload(createDownload({ nzoId: "recent", addedAt: base }));

      expect(getAllDownloads(base + DAY_MS - 1)).toHaveLength(1);
    });

    it("evicts stale entries when a new download arrives, not only on read", () => {
      const base = 1_700_000_000_000;
      addDownload(createDownload({ nzoId: "old", addedAt: base }));

      addDownload(createDownload({ nzoId: "new", addedAt: base + DAY_MS + 1 }));

      expect(getDownload("old")).toBeUndefined();
      expect(getDownload("new")).toBeDefined();
    });
  });
});
