import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetFreshReleases = vi.fn();

vi.mock("../../api/listenbrainz/freshReleases", () => ({
  getFreshReleases: (...args: unknown[]) => mockGetFreshReleases(...args),
  MAX_FRESH_RELEASES_DAYS: 90,
}));

vi.mock("../../logger", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

import { getCachedFreshReleases, clearFreshReleasesCache } from "./feedCache";

const release = {
  artistName: "A",
  artistMbids: ["mbid-a"],
  releaseName: "R",
  releaseDate: "2026-07-01",
  releaseGroupMbid: "rg-1",
  primaryType: "Album",
  secondaryType: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  clearFreshReleasesCache();
});

describe("getCachedFreshReleases", () => {
  it("fetches on first call and serves from cache within the TTL", async () => {
    mockGetFreshReleases.mockResolvedValue([release]);

    const first = await getCachedFreshReleases(1_000);
    const second = await getCachedFreshReleases(2_000);

    expect(first).toEqual([release]);
    expect(second).toEqual([release]);
    expect(mockGetFreshReleases).toHaveBeenCalledTimes(1);
  });

  it("refetches after the TTL expires", async () => {
    mockGetFreshReleases.mockResolvedValue([release]);

    await getCachedFreshReleases(0);
    await getCachedFreshReleases(6 * 60 * 60 * 1000 + 1);

    expect(mockGetFreshReleases).toHaveBeenCalledTimes(2);
  });

  it("does not cache an empty result", async () => {
    mockGetFreshReleases.mockResolvedValueOnce([]).mockResolvedValue([release]);

    const first = await getCachedFreshReleases(1_000);
    const second = await getCachedFreshReleases(2_000);

    expect(first).toEqual([]);
    expect(second).toEqual([release]);
    expect(mockGetFreshReleases).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent fetches", async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    mockGetFreshReleases.mockImplementation(
      () => new Promise((resolve) => (resolveFetch = resolve))
    );

    const p1 = getCachedFreshReleases(1_000);
    const p2 = getCachedFreshReleases(1_000);
    resolveFetch([release]);

    expect(await p1).toEqual([release]);
    expect(await p2).toEqual([release]);
    expect(mockGetFreshReleases).toHaveBeenCalledTimes(1);
  });
});
