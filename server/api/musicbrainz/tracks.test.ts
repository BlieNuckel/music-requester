import { describe, it, expect, vi, beforeEach } from "vitest";
import { getReleaseTracks } from "./tracks";

const mockFetch = vi.fn();
const mockAcquireMbSlot = vi.fn((..._args: unknown[]) => Promise.resolve());

vi.mock("../resilientFetch", () => ({
  resilientFetch: (...args: unknown[]) => mockFetch(...args),
}));

vi.mock("./queue", () => ({
  acquireMbSlot: (...args: unknown[]) => mockAcquireMbSlot(...args),
  reportMbSuccess: () => {},
  reportMbThrottled: () => {},
}));

import { clearMbCache } from "./cache";

beforeEach(() => {
  vi.clearAllMocks();
  mockAcquireMbSlot.mockResolvedValue(undefined);
  clearMbCache();
});

describe("getReleaseTracks", () => {
  it("maps tracks from first release", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          releases: [
            {
              media: [
                {
                  position: 1,
                  format: "CD",
                  title: "Disc 1",
                  tracks: [
                    {
                      position: 1,
                      title: "Track One",
                      length: 240000,
                      recording: { title: "Track One Recording" },
                    },
                    {
                      position: 2,
                      title: "Track Two",
                      length: null,
                      recording: { title: "Track Two Recording" },
                    },
                  ],
                },
              ],
            },
          ],
        }),
    });

    const result = await getReleaseTracks("rg-123");
    expect(result).toHaveLength(1);
    expect(result[0].position).toBe(1);
    expect(result[0].format).toBe("CD");
    expect(result[0].tracks).toHaveLength(2);
    expect(result[0].tracks[0].title).toBe("Track One Recording");
    expect(result[0].tracks[1].length).toBeNull();
  });

  it("returns empty array when no releases", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ releases: [] }),
    });

    const result = await getReleaseTracks("rg-empty");
    expect(result).toEqual([]);
  });

  it("returns an empty listing when the release group does not exist", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    expect(await getReleaseTracks("bad")).toEqual([]);
  });

  it("throws rather than caching a throttled response as 'no tracks'", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    await expect(getReleaseTracks("rg-1")).rejects.toThrow(
      "MusicBrainz returned 503"
    );
  });

  it("handles release with empty media", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ releases: [{ media: [] }] }),
    });

    const result = await getReleaseTracks("rg-no-media");
    expect(result).toEqual([]);
  });
});
