import { describe, it, expect, vi, beforeEach } from "vitest";
import { getMusicSectionKeys } from "./sections";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const HEADERS = { "X-Plex-Token": "tok" };

beforeEach(() => {
  vi.clearAllMocks();
});

function okResponse(data: unknown) {
  return { ok: true, json: () => Promise.resolve(data) };
}

describe("getMusicSectionKeys", () => {
  it("returns every music section, not just the first", async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        MediaContainer: {
          Directory: [
            { key: "1", type: "movie", title: "Movies" },
            { key: "2", type: "artist", title: "Music" },
            { key: "5", type: "artist", title: "Soundtracks" },
            { key: "7", type: "artist", title: "Classical" },
          ],
        },
      })
    );

    expect(await getMusicSectionKeys("http://plex:32400", HEADERS)).toEqual([
      "2",
      "5",
      "7",
    ]);
  });

  it("throws when the server has no music library", async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        MediaContainer: { Directory: [{ key: "1", type: "movie" }] },
      })
    );

    await expect(
      getMusicSectionKeys("http://plex:32400", HEADERS)
    ).rejects.toThrow("No music library found in Plex");
  });

  it("throws when Plex rejects the request", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });

    await expect(
      getMusicSectionKeys("http://plex:32400", HEADERS)
    ).rejects.toThrow("Plex returned 401");
  });
});
