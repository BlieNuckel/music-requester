import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAlbumByMbid = vi.fn();
const mockGetOrAddArtist = vi.fn();
const mockGetOrAddAlbum = vi.fn();
const mockLidarrGet = vi.fn();
const mockLidarrPost = vi.fn();

vi.mock("./helpers", () => ({
  getAlbumByMbid: (...args: unknown[]) => mockGetAlbumByMbid(...args),
  getOrAddArtist: (...args: unknown[]) => mockGetOrAddArtist(...args),
  getOrAddAlbum: (...args: unknown[]) => mockGetOrAddAlbum(...args),
}));

vi.mock("../../api/lidarr/get", () => ({
  lidarrGet: (...args: unknown[]) => mockLidarrGet(...args),
}));

vi.mock("../../api/lidarr/post", () => ({
  lidarrPost: (...args: unknown[]) => mockLidarrPost(...args),
}));

import {
  ALLOWED_EXTENSIONS,
  scanUploadedFiles,
  toManualImportItem,
  buildConfirmPayload,
  confirmImport,
} from "./import";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ALLOWED_EXTENSIONS", () => {
  it("includes common audio formats", () => {
    expect(ALLOWED_EXTENSIONS).toContain(".flac");
    expect(ALLOWED_EXTENSIONS).toContain(".mp3");
    expect(ALLOWED_EXTENSIONS).toContain(".ogg");
  });
});

describe("scanUploadedFiles", () => {
  it("returns 404 error when album has no foreignArtistId", async () => {
    mockGetAlbumByMbid.mockResolvedValue({ artist: {} });

    const result = await scanUploadedFiles("mbid-1", "/uploads/test");
    expect(result).toEqual({
      ok: false,
      error: "Could not determine artist from album lookup",
      status: 404,
    });
  });

  it("returns 502 error when Lidarr scan fails", async () => {
    mockGetAlbumByMbid.mockResolvedValue({
      artist: { foreignArtistId: "artist-mbid" },
    });
    mockGetOrAddArtist.mockResolvedValue({ id: 1 });
    mockGetOrAddAlbum.mockResolvedValue({ album: { id: 10 } });
    mockLidarrGet.mockResolvedValue({ ok: false, status: 500, data: null });

    const result = await scanUploadedFiles("mbid-1", "/uploads/test");
    expect(result).toEqual({
      ok: false,
      error: "Lidarr manual import scan failed",
      status: 502,
    });
  });

  it("returns 400 error when scan returns no items", async () => {
    mockGetAlbumByMbid.mockResolvedValue({
      artist: { foreignArtistId: "artist-mbid" },
    });
    mockGetOrAddArtist.mockResolvedValue({ id: 1 });
    mockGetOrAddAlbum.mockResolvedValue({ album: { id: 10 } });
    mockLidarrGet.mockResolvedValue({ ok: true, status: 200, data: [] });

    const result = await scanUploadedFiles("mbid-1", "/uploads/test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });

  it("returns artist/album IDs and items on success", async () => {
    mockGetAlbumByMbid.mockResolvedValue({
      artist: { foreignArtistId: "artist-mbid" },
    });
    mockGetOrAddArtist.mockResolvedValue({ id: 1 });
    mockGetOrAddAlbum.mockResolvedValue({ album: { id: 10 } });
    const scanItems = [{ path: "/uploads/test/song.flac", name: "song.flac" }];
    mockLidarrGet.mockResolvedValue({ ok: true, status: 200, data: scanItems });

    const result = await scanUploadedFiles("mbid-1", "/uploads/test");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artistId).toBe(1);
      expect(result.albumId).toBe(10);
      expect(result.items).toEqual(scanItems);
    }
  });

  it("strips the embedded artist and album resources from scan items", async () => {
    mockGetAlbumByMbid.mockResolvedValue({
      artist: { foreignArtistId: "artist-mbid" },
    });
    mockGetOrAddArtist.mockResolvedValue({ id: 1 });
    mockGetOrAddAlbum.mockResolvedValue({ album: { id: 10 } });
    mockLidarrGet.mockResolvedValue({
      ok: true,
      status: 200,
      data: [
        {
          path: "/uploads/test/song.flac",
          name: "song.flac",
          artist: {
            id: 1,
            overview: "x".repeat(4000),
            images: [{ url: "/cover.jpg" }],
            statistics: { trackCount: 12 },
          },
          album: {
            id: 10,
            releases: [{ id: 99, media: [{ mediumNumber: 1 }] }],
            overview: "y".repeat(4000),
          },
        },
      ],
    });

    const result = await scanUploadedFiles("mbid-1", "/uploads/test");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items[0].artist).toEqual({ id: 1 });
      expect(result.items[0].album).toEqual({ id: 10 });
      expect(JSON.stringify(result.items).length).toBeLessThan(500);
    }
  });
});

describe("toManualImportItem", () => {
  it("keeps only the fields the UI and confirm payload need", () => {
    const raw = {
      path: "/uploads/song.flac",
      name: "song.flac",
      albumReleaseId: 55,
      indexerFlags: 0,
      downloadId: "dl-1",
      disableReleaseSwitching: false,
      quality: { quality: { name: "FLAC", id: 7, source: 1 }, revision: {} },
      rejections: [{ reason: "Unknown track", type: "permanent" }],
      tracks: [
        {
          id: 3,
          title: "Track One",
          trackNumber: "1",
          duration: 210000,
          absoluteTrackNumber: 1,
        },
      ],
      artist: { id: 1, overview: "long text" },
      album: { id: 10, releases: [{ id: 99 }] },
      customFormats: [{ id: 1, name: "noise" }],
    };

    expect(toManualImportItem(raw)).toEqual({
      path: "/uploads/song.flac",
      name: "song.flac",
      albumReleaseId: 55,
      indexerFlags: 0,
      downloadId: "dl-1",
      disableReleaseSwitching: false,
      quality: { quality: { name: "FLAC" } },
      rejections: [{ reason: "Unknown track" }],
      tracks: [{ id: 3, title: "Track One", trackNumber: "1" }],
      artist: { id: 1 },
      album: { id: 10 },
    });
  });

  it("leaves fields Lidarr omitted for an unmatched file undefined", () => {
    const item = toManualImportItem({ path: "/uploads/mystery.flac" });

    expect(item).toEqual({ path: "/uploads/mystery.flac" });
    expect(item.tracks).toBeUndefined();
    expect(item.album).toBeUndefined();
  });
});

describe("buildConfirmPayload", () => {
  it("maps items to command file format", () => {
    const items = [
      {
        path: "/imports/song.flac",
        artist: { id: 1 },
        album: { id: 10 },
        albumReleaseId: 5,
        tracks: [{ id: 1 }, { id: 2 }],
        quality: { quality: { name: "FLAC" } },
        indexerFlags: 0,
        downloadId: "dl-1",
        disableReleaseSwitching: false,
      },
    ] as Parameters<typeof buildConfirmPayload>[0];

    const payload = buildConfirmPayload(items);

    expect(payload).toEqual([
      {
        path: "/imports/song.flac",
        artistId: 1,
        albumId: 10,
        albumReleaseId: 5,
        trackIds: [1, 2],
        quality: { quality: { name: "FLAC" } },
        indexerFlags: 0,
        downloadId: "dl-1",
        disableReleaseSwitching: false,
      },
    ]);
  });

  it("defaults optional fields when not provided", () => {
    const items = [
      {
        path: "/imports/song.flac",
        artist: { id: 1 },
        album: { id: 10 },
        albumReleaseId: 5,
        tracks: [{ id: 1 }],
        quality: { quality: { name: "FLAC" } },
      },
    ] as Parameters<typeof buildConfirmPayload>[0];

    const payload = buildConfirmPayload(items);

    expect(payload[0].indexerFlags).toBe(0);
    expect(payload[0].downloadId).toBe("");
    expect(payload[0].disableReleaseSwitching).toBe(false);
  });
});

describe("confirmImport", () => {
  it("sends ManualImport command to Lidarr", async () => {
    mockLidarrPost.mockResolvedValue({ ok: true, status: 200, data: {} });

    const items = [
      {
        path: "/imports/song.flac",
        artist: { id: 1 },
        album: { id: 10 },
        albumReleaseId: 5,
        tracks: [{ id: 1 }],
        quality: { quality: { name: "FLAC" } },
      },
    ] as Parameters<typeof confirmImport>[0];

    const result = await confirmImport(items);

    expect(result.ok).toBe(true);
    expect(mockLidarrPost).toHaveBeenCalledWith("/command", {
      name: "ManualImport",
      files: expect.arrayContaining([
        expect.objectContaining({ path: "/imports/song.flac" }),
      ]),
      importMode: "move",
    });
  });
});
