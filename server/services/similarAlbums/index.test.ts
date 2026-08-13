import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAlbumDetails = vi.fn();
const mockSearchReleaseGroups = vi.fn();
const mockCollectTagCandidates = vi.fn();
const mockCollectArtistCandidates = vi.fn();
const mockGetConfigValue = vi.fn();

vi.mock("../../api/musicbrainz/releaseGroups", () => ({
  getAlbumDetails: (...args: unknown[]) => mockGetAlbumDetails(...args),
  searchReleaseGroups: (...args: unknown[]) => mockSearchReleaseGroups(...args),
}));

vi.mock("./tagLeg", () => ({
  collectTagCandidates: (...args: unknown[]) =>
    mockCollectTagCandidates(...args),
}));

vi.mock("./artistLeg", () => ({
  collectArtistCandidates: (...args: unknown[]) =>
    mockCollectArtistCandidates(...args),
}));

vi.mock("../../config", () => ({
  getConfigValue: (...args: unknown[]) => mockGetConfigValue(...args),
}));

import { getSimilarAlbums } from "./index";
import type { AlbumCandidate } from "./types";

const seedDetails = {
  mbid: "seed-rg",
  title: "Souvlaki",
  artistName: "Slowdive",
  artistMbid: "slowdive-mbid",
  firstReleaseDate: "1993-05-17",
  primaryType: "Album",
  secondaryTypes: [],
};

function candidate(overrides: Partial<AlbumCandidate> = {}): AlbumCandidate {
  return {
    title: "Loveless",
    artistName: "My Bloody Valentine",
    artistMbid: "mbv-mbid",
    mbid: "mbv-loveless",
    score: 0.5,
    reason: "tag",
    ...overrides,
  };
}

function searchHit(artistName: string, title: string, id: string) {
  return {
    "release-groups": [
      {
        id,
        score: 100,
        title,
        "primary-type": "Album",
        "first-release-date": "1991-11-04",
        "artist-credit": [
          { name: artistName, artist: { id: "a", name: artistName } },
        ],
      },
    ],
    count: 1,
    offset: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSimilarAlbums.clearCache();
  mockGetConfigValue.mockReturnValue({ genericTags: ["seen live"] });
  mockGetAlbumDetails.mockResolvedValue(seedDetails);
  mockCollectTagCandidates.mockResolvedValue([]);
  mockCollectArtistCandidates.mockResolvedValue([]);
  mockSearchReleaseGroups.mockResolvedValue({
    "release-groups": [],
    count: 0,
    offset: 0,
  });
});

describe("getSimilarAlbums", () => {
  it("returns empty when the seed album can't be resolved", async () => {
    mockGetAlbumDetails.mockResolvedValue(null);

    expect(await getSimilarAlbums("unknown-rg")).toEqual([]);
    expect(mockCollectTagCandidates).not.toHaveBeenCalled();
  });

  it("passes lowercased generic tags to the tag leg", async () => {
    mockGetConfigValue.mockReturnValue({ genericTags: ["Seen Live"] });

    await getSimilarAlbums("seed-rg");

    const genericTags = mockCollectTagCandidates.mock.calls[0][1];
    expect(genericTags.has("seen live")).toBe(true);
  });

  it("blends both legs into one ranked list", async () => {
    mockCollectTagCandidates.mockResolvedValue([
      candidate({ title: "Loveless", mbid: "mbv-loveless", score: 0.4 }),
    ]);
    mockCollectArtistCandidates.mockResolvedValue([
      candidate({
        title: "Nowhere",
        artistName: "Ride",
        artistMbid: "ride-mbid",
        mbid: "ride-nowhere",
        score: 1,
        reason: "artist",
      }),
    ]);

    const albums = await getSimilarAlbums("seed-rg");
    expect(albums.map((a) => a.title)).toEqual(["Nowhere", "Loveless"]);
    expect(albums[0].reasons).toEqual(["artist"]);
  });

  it("caps results at twelve", async () => {
    mockCollectTagCandidates.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) =>
        candidate({
          title: `Album ${i}`,
          artistName: `Artist ${i}`,
          artistMbid: `mbid-${i}`,
          mbid: `rg-${i}`,
          score: 1 - i / 100,
        })
      )
    );

    expect(await getSimilarAlbums("seed-rg")).toHaveLength(12);
  });

  it("resolves a missing mbid through a release-group search", async () => {
    mockCollectTagCandidates.mockResolvedValue([
      candidate({ mbid: "", score: 1 }),
    ]);
    mockSearchReleaseGroups.mockResolvedValue(
      searchHit("My Bloody Valentine", "Loveless", "resolved-rg")
    );

    const albums = await getSimilarAlbums("seed-rg");
    expect(albums).toHaveLength(1);
    expect(albums[0].mbid).toBe("resolved-rg");
    expect(albums[0].year).toBe("1991");
    expect(mockSearchReleaseGroups).toHaveBeenCalledWith(
      'releasegroup:"Loveless" AND artist:"My Bloody Valentine"'
    );
  });

  it("drops a candidate whose search returns a different album", async () => {
    mockCollectTagCandidates.mockResolvedValue([
      candidate({ mbid: "", score: 1 }),
    ]);
    mockSearchReleaseGroups.mockResolvedValue(
      searchHit("My Bloody Valentine", "Isn't Anything", "other-rg")
    );

    expect(await getSimilarAlbums("seed-rg")).toEqual([]);
  });

  it("drops a candidate whose search fails", async () => {
    mockCollectTagCandidates.mockResolvedValue([
      candidate({ mbid: "", score: 1 }),
    ]);
    mockSearchReleaseGroups.mockRejectedValue(new Error("MusicBrainz down"));

    expect(await getSimilarAlbums("seed-rg")).toEqual([]);
  });

  it("spends at most five searches on unresolved candidates", async () => {
    mockCollectTagCandidates.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) =>
        candidate({
          title: `Album ${i}`,
          artistName: `Artist ${i}`,
          artistMbid: `mbid-${i}`,
          mbid: "",
          score: 1 - i / 100,
        })
      )
    );

    await getSimilarAlbums("seed-rg");
    expect(mockSearchReleaseGroups).toHaveBeenCalledTimes(5);
  });

  it("does not spend the search budget on candidates that already have an mbid", async () => {
    mockCollectTagCandidates.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) =>
        candidate({
          title: `Album ${i}`,
          artistName: `Artist ${i}`,
          artistMbid: `mbid-${i}`,
          mbid: `rg-${i}`,
        })
      )
    );

    await getSimilarAlbums("seed-rg");
    expect(mockSearchReleaseGroups).not.toHaveBeenCalled();
  });

  it("serves a repeat request from cache", async () => {
    mockCollectTagCandidates.mockResolvedValue([candidate()]);

    const first = await getSimilarAlbums("seed-rg");
    const second = await getSimilarAlbums("seed-rg");

    expect(second).toEqual(first);
    expect(mockGetAlbumDetails).toHaveBeenCalledTimes(1);
  });

  it("caches per album", async () => {
    await getSimilarAlbums("seed-rg");
    await getSimilarAlbums("other-rg");

    expect(mockGetAlbumDetails).toHaveBeenCalledTimes(2);
  });
});
