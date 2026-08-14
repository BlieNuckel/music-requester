import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetConfigValue = vi.fn();
const mockGetPromotedAlbums = vi.fn();
const mockListWarmableUsers = vi.fn();
const mockCacheExpiry = vi.fn();

vi.mock("../config", () => ({
  getConfigValue: (...args: unknown[]) => mockGetConfigValue(...args),
}));

vi.mock("./getPromotedAlbum", () => ({
  getPromotedAlbums: (...args: unknown[]) => mockGetPromotedAlbums(...args),
  listWarmableUsers: (...args: unknown[]) => mockListWarmableUsers(...args),
  promotedAlbumCacheExpiry: (...args: unknown[]) => mockCacheExpiry(...args),
  SPOTLIGHT_COUNT: 5,
}));

vi.mock("../logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { runSpotlightWarmOnce } from "./warmer";

const INTERVAL_MS = 30 * 60 * 1000;
const NOW = 1_000_000;

function ready() {
  return { status: "ready", albums: [{ album: { mbid: "rg-1" } }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConfigValue.mockReturnValue({ backgroundRegenEnabled: true });
  mockGetPromotedAlbums.mockResolvedValue(ready());
  mockListWarmableUsers.mockReturnValue([]);
  mockCacheExpiry.mockReturnValue(undefined);
});

describe("runSpotlightWarmOnce", () => {
  it("rebuilds for a user whose carousel has already lapsed", async () => {
    mockListWarmableUsers.mockReturnValue([7]);

    await runSpotlightWarmOnce(INTERVAL_MS, NOW);

    expect(mockGetPromotedAlbums).toHaveBeenCalledWith(7, true, 5, {
      source: "warmer",
    });
  });

  it("rebuilds for a user whose carousel expires before the next tick", async () => {
    mockListWarmableUsers.mockReturnValue([7]);
    mockCacheExpiry.mockReturnValue(NOW + INTERVAL_MS - 1);

    await runSpotlightWarmOnce(INTERVAL_MS, NOW);

    expect(mockGetPromotedAlbums).toHaveBeenCalledTimes(1);
  });

  it("leaves a carousel that outlives the next tick alone", async () => {
    mockListWarmableUsers.mockReturnValue([7]);
    mockCacheExpiry.mockReturnValue(NOW + INTERVAL_MS + 1);

    await runSpotlightWarmOnce(INTERVAL_MS, NOW);

    expect(mockGetPromotedAlbums).not.toHaveBeenCalled();
  });

  it("only considers users who loaded the carousel recently", async () => {
    mockListWarmableUsers.mockReturnValue([]);

    await runSpotlightWarmOnce(INTERVAL_MS, NOW);

    expect(mockListWarmableUsers).toHaveBeenCalledWith(NOW);
    expect(mockGetPromotedAlbums).not.toHaveBeenCalled();
  });

  it("does nothing when background regeneration is switched off", async () => {
    mockGetConfigValue.mockReturnValue({ backgroundRegenEnabled: false });
    mockListWarmableUsers.mockReturnValue([7]);

    await runSpotlightWarmOnce(INTERVAL_MS, NOW);

    expect(mockGetPromotedAlbums).not.toHaveBeenCalled();
  });

  it("keeps warming the rest after one user fails", async () => {
    mockListWarmableUsers.mockReturnValue([1, 2]);
    mockGetPromotedAlbums
      .mockRejectedValueOnce(new Error("plex down"))
      .mockResolvedValue(ready());

    await runSpotlightWarmOnce(INTERVAL_MS, NOW);

    expect(mockGetPromotedAlbums).toHaveBeenCalledTimes(2);
  });

  it("skips a tick that lands while the previous sweep is still running", async () => {
    mockListWarmableUsers.mockReturnValue([7]);
    let release!: () => void;
    mockGetPromotedAlbums.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve(ready());
      })
    );

    const first = runSpotlightWarmOnce(INTERVAL_MS, NOW);
    await runSpotlightWarmOnce(INTERVAL_MS, NOW);
    release();
    await first;

    expect(mockGetPromotedAlbums).toHaveBeenCalledTimes(1);
  });
});
