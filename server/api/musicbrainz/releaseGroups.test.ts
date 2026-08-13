import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  searchReleaseGroups,
  getReleaseGroupById,
  getReleaseGroupIdFromRelease,
  resolveReleaseGroupInfo,
  getReleaseGroupLabel,
  getReleaseGroupDate,
  getAlbumDetails,
} from "./releaseGroups";

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

import { MB_BASE, MB_HEADERS } from "./config";
import { clearMbCache } from "./cache";

beforeEach(() => {
  vi.clearAllMocks();
  mockAcquireMbSlot.mockResolvedValue(undefined);
  clearMbCache();
});

function okResponse(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

function errorResponse(status: number) {
  return { ok: false, status, json: () => Promise.resolve({}) };
}

describe("searchReleaseGroups", () => {
  it("returns release groups sorted by score", async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        "release-groups": [
          { id: "1", score: 50, title: "Low Score" },
          { id: "2", score: 100, title: "High Score" },
          { id: "3", score: 75, title: "Mid Score" },
        ],
        count: 3,
        offset: 0,
      })
    );

    const result = await searchReleaseGroups("test");
    expect(result["release-groups"][0].score).toBe(100);
    expect(result["release-groups"][1].score).toBe(75);
    expect(result["release-groups"][2].score).toBe(50);
    expect(result.count).toBe(3);
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValue(errorResponse(503));

    await expect(searchReleaseGroups("test")).rejects.toThrow(
      "MusicBrainz returned 503"
    );
  });
});

describe("getReleaseGroupById", () => {
  it("returns artist name and album title from release group MBID", async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        id: "rg-123",
        title: "OK Computer",
        "artist-credit": [
          { name: "Radiohead", artist: { id: "a1", name: "Radiohead" } },
        ],
      })
    );

    const result = await getReleaseGroupById("rg-123");
    expect(result).toEqual({
      artistName: "Radiohead",
      albumTitle: "OK Computer",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${MB_BASE}/release-group/rg-123?inc=artist-credits&fmt=json`,
      { headers: MB_HEADERS },
      { retry: false }
    );
  });

  it("returns null when release group not found", async () => {
    mockFetch.mockResolvedValue(errorResponse(404));

    const result = await getReleaseGroupById("nonexistent");
    expect(result).toBeNull();
  });

  it("returns 'Unknown Artist' when artist-credit is empty", async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        id: "rg-123",
        title: "Mystery Album",
        "artist-credit": [],
      })
    );

    const result = await getReleaseGroupById("rg-123");
    expect(result).toEqual({
      artistName: "Unknown Artist",
      albumTitle: "Mystery Album",
    });
  });
});

describe("getAlbumDetails", () => {
  it("returns full album metadata including artist MBID and type", async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        id: "rg-123",
        title: "OK Computer",
        "primary-type": "Album",
        "first-release-date": "1997-06-16",
        "secondary-types": ["Live"],
        "artist-credit": [
          { name: "Radiohead", artist: { id: "a1", name: "Radiohead" } },
        ],
      })
    );

    const result = await getAlbumDetails("rg-123");
    expect(result).toEqual({
      mbid: "rg-123",
      title: "OK Computer",
      artistName: "Radiohead",
      artistMbid: "a1",
      firstReleaseDate: "1997-06-16",
      primaryType: "Album",
      secondaryTypes: ["Live"],
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${MB_BASE}/release-group/rg-123?inc=artist-credits&fmt=json`,
      { headers: MB_HEADERS },
      { retry: false }
    );
  });

  it("falls back to defaults when fields are missing", async () => {
    mockFetch.mockResolvedValue(
      okResponse({ id: "rg-456", "artist-credit": [] })
    );

    const result = await getAlbumDetails("rg-456");
    expect(result).toEqual({
      mbid: "rg-456",
      title: "Unknown Album",
      artistName: "Unknown Artist",
      artistMbid: null,
      firstReleaseDate: null,
      primaryType: null,
      secondaryTypes: [],
    });
  });

  it("returns null when the release group is not found", async () => {
    mockFetch.mockResolvedValue(errorResponse(404));

    const result = await getAlbumDetails("nonexistent");
    expect(result).toBeNull();
  });
});

describe("getReleaseGroupIdFromRelease", () => {
  it("returns release-group info from release MBID", async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        id: "release-123",
        title: "OK Computer",
        "release-group": {
          id: "rg-456",
          title: "OK Computer",
          "first-release-date": "1997-06-16",
          "primary-type": "Album",
          "secondary-types": ["Live"],
        },
      })
    );

    const result = await getReleaseGroupIdFromRelease("release-123");
    expect(result).toEqual({
      id: "rg-456",
      firstReleaseDate: "1997-06-16",
      primaryType: "Album",
      secondaryTypes: ["Live"],
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${MB_BASE}/release/release-123?inc=release-groups&fmt=json`,
      { headers: MB_HEADERS },
      { retry: false }
    );
  });

  it("returns empty firstReleaseDate when not present", async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        id: "release-123",
        title: "OK Computer",
        "release-group": {
          id: "rg-456",
          title: "OK Computer",
        },
      })
    );

    const result = await getReleaseGroupIdFromRelease("release-123");
    expect(result).toEqual({
      id: "rg-456",
      firstReleaseDate: "",
      primaryType: null,
      secondaryTypes: [],
    });
  });

  it("returns null when release not found", async () => {
    mockFetch.mockResolvedValue(errorResponse(404));

    const result = await getReleaseGroupIdFromRelease("nonexistent");
    expect(result).toBeNull();
  });

  it("returns null when release-group is missing", async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        id: "release-123",
        title: "Some Release",
      })
    );

    const result = await getReleaseGroupIdFromRelease("release-123");
    expect(result).toBeNull();
  });
});

describe("resolveReleaseGroupInfo", () => {
  it("returns the release group when the MBID is a release", async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        id: "release-123",
        title: "Kid A",
        "release-group": {
          id: "rg-456",
          title: "Kid A",
          "first-release-date": "2000-10-02",
          "primary-type": "Album",
        },
      })
    );

    const result = await resolveReleaseGroupInfo("release-123");

    expect(result).toEqual({
      id: "rg-456",
      firstReleaseDate: "2000-10-02",
      primaryType: "Album",
      secondaryTypes: [],
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries the MBID as a release group when the release lookup misses", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(404)).mockResolvedValueOnce(
      okResponse({
        id: "rg-456",
        title: "Kid A",
        "first-release-date": "2000-10-02",
        "primary-type": "Album",
        "secondary-types": ["Live"],
      })
    );

    const result = await resolveReleaseGroupInfo("rg-456");

    expect(result).toEqual({
      id: "rg-456",
      firstReleaseDate: "2000-10-02",
      primaryType: "Album",
      secondaryTypes: ["Live"],
    });
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      `${MB_BASE}/release-group/rg-456?fmt=json`,
      { headers: MB_HEADERS },
      { retry: false }
    );
  });

  it("returns null when the MBID is neither", async () => {
    mockFetch.mockResolvedValue(errorResponse(404));

    expect(await resolveReleaseGroupInfo("nonexistent")).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("spends no further slots on a repeat lookup", async () => {
    mockFetch
      .mockResolvedValueOnce(errorResponse(404))
      .mockResolvedValueOnce(
        okResponse({ id: "rg-456", "first-release-date": "2000-10-02" })
      );

    await resolveReleaseGroupInfo("rg-456");
    await resolveReleaseGroupInfo("rg-456");

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("getReleaseGroupLabel", () => {
  it("returns label name and mbid from first release", async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        releases: [
          {
            id: "rel-1",
            "label-info": [{ label: { id: "label-1", name: "Warp Records" } }],
          },
        ],
      })
    );

    const result = await getReleaseGroupLabel("rg-123");
    expect(result).toEqual({ name: "Warp Records", mbid: "label-1" });
    expect(mockFetch).toHaveBeenCalledWith(
      `${MB_BASE}/release?release-group=rg-123&inc=labels&limit=1&fmt=json`,
      { headers: MB_HEADERS },
      { retry: false }
    );
  });

  it("returns null when no releases exist", async () => {
    mockFetch.mockResolvedValue(okResponse({ releases: [] }));

    const result = await getReleaseGroupLabel("rg-empty");
    expect(result).toBeNull();
  });

  it("returns null when label-info is empty", async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        releases: [{ id: "rel-1", "label-info": [] }],
      })
    );

    const result = await getReleaseGroupLabel("rg-nolabel");
    expect(result).toBeNull();
  });

  it("returns null when label-info is missing", async () => {
    mockFetch.mockResolvedValue(okResponse({ releases: [{ id: "rel-1" }] }));

    const result = await getReleaseGroupLabel("rg-nolabelinfo");
    expect(result).toBeNull();
  });

  it("returns null when label object is missing from label-info entry", async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        releases: [{ id: "rel-1", "label-info": [{}] }],
      })
    );

    const result = await getReleaseGroupLabel("rg-nolabelobj");
    expect(result).toBeNull();
  });

  it("returns null when the release group does not exist", async () => {
    mockFetch.mockResolvedValue(errorResponse(404));

    const result = await getReleaseGroupLabel("rg-missing");
    expect(result).toBeNull();
  });

  it("throws rather than caching a throttled response as 'no label'", async () => {
    mockFetch.mockResolvedValue(errorResponse(503));

    await expect(getReleaseGroupLabel("rg-error")).rejects.toThrow(
      "MusicBrainz returned 503"
    );
  });
});

describe("getReleaseGroupDate", () => {
  it("returns first-release-date from release group", async () => {
    mockFetch.mockResolvedValue(
      okResponse({ "first-release-date": "1997-06-16" })
    );

    const result = await getReleaseGroupDate("rg-123");
    expect(result).toBe("1997-06-16");
    expect(mockFetch).toHaveBeenCalledWith(
      `${MB_BASE}/release-group/rg-123?fmt=json`,
      { headers: MB_HEADERS },
      { retry: false }
    );
  });

  it("returns null when date is empty string", async () => {
    mockFetch.mockResolvedValue(okResponse({ "first-release-date": "" }));

    const result = await getReleaseGroupDate("rg-nodate");
    expect(result).toBeNull();
  });

  it("returns null when date field is missing", async () => {
    mockFetch.mockResolvedValue(okResponse({}));

    const result = await getReleaseGroupDate("rg-nofield");
    expect(result).toBeNull();
  });

  it("returns null on non-ok response", async () => {
    mockFetch.mockResolvedValue(errorResponse(404));

    const result = await getReleaseGroupDate("rg-notfound");
    expect(result).toBeNull();
  });
});
