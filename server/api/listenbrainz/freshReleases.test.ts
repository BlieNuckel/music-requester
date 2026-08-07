import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResilientFetch = vi.fn();

vi.mock("../resilientFetch", () => ({
  resilientFetch: (...args: unknown[]) => mockResilientFetch(...args),
}));

import { getFreshReleases, MAX_FRESH_RELEASES_DAYS } from "./freshReleases";

const sampleRelease = {
  artist_credit_name: "Radiohead",
  artist_mbids: ["mbid-radiohead"],
  caa_id: 123,
  caa_release_mbid: "rel-1",
  listen_count: 4,
  release_date: "2026-07-01",
  release_group_mbid: "rg-1",
  release_group_primary_type: "Album",
  release_group_secondary_type: null,
  release_mbid: "rel-1",
  release_name: "New Album",
  release_tags: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getFreshReleases", () => {
  it("maps feed entries to the trimmed shape", async () => {
    mockResilientFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ payload: { releases: [sampleRelease] } }),
    });

    const result = await getFreshReleases(30);
    expect(result).toEqual([
      {
        artistName: "Radiohead",
        artistMbids: ["mbid-radiohead"],
        releaseName: "New Album",
        releaseDate: "2026-07-01",
        releaseGroupMbid: "rg-1",
        primaryType: "Album",
        secondaryType: null,
      },
    ]);
    const url = mockResilientFetch.mock.calls[0][0] as string;
    expect(url).toContain("/1/explore/fresh-releases/?days=30");
  });

  it("clamps days to the API maximum", async () => {
    mockResilientFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ payload: { releases: [] } }),
    });

    await getFreshReleases(500);
    const url = mockResilientFetch.mock.calls[0][0] as string;
    expect(url).toContain(`days=${MAX_FRESH_RELEASES_DAYS}`);
  });

  it("drops entries missing MBIDs or a release name", async () => {
    mockResilientFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          payload: {
            releases: [
              sampleRelease,
              { ...sampleRelease, release_group_mbid: undefined },
              { ...sampleRelease, artist_mbids: [] },
              { ...sampleRelease, release_name: undefined },
            ],
          },
        }),
    });

    const result = await getFreshReleases();
    expect(result).toHaveLength(1);
  });

  it("returns [] on non-ok response", async () => {
    mockResilientFetch.mockResolvedValue({ ok: false, status: 500 });
    expect(await getFreshReleases()).toEqual([]);
  });

  it("returns [] when fetch throws", async () => {
    mockResilientFetch.mockRejectedValue(new Error("network down"));
    expect(await getFreshReleases()).toEqual([]);
  });

  it("returns [] on malformed payload", async () => {
    mockResilientFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ payload: { releases: "nope" } }),
    });
    expect(await getFreshReleases()).toEqual([]);
  });
});
