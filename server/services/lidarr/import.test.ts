import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAlbumByMbid = vi.fn();
const mockGetOrAddArtist = vi.fn();
const mockGetOrAddAlbum = vi.fn();
const mockWaitForAlbumTracks = vi.fn();
const mockLidarrGet = vi.fn();
const mockLidarrPost = vi.fn();

vi.mock("./helpers", () => ({
  getAlbumByMbid: (...args: unknown[]) => mockGetAlbumByMbid(...args),
  getOrAddArtist: (...args: unknown[]) => mockGetOrAddArtist(...args),
  getOrAddAlbum: (...args: unknown[]) => mockGetOrAddAlbum(...args),
  waitForAlbumTracks: (...args: unknown[]) => mockWaitForAlbumTracks(...args),
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
  findImportProblems,
} from "./import";

const completeItem = {
  path: "/imports/song.flac",
  artist: { id: 1 },
  album: { id: 10 },
  albumReleaseId: 5,
  tracks: [{ id: 1, title: "One", trackNumber: "1" }],
  quality: { quality: { id: 7, name: "FLAC" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockWaitForAlbumTracks.mockResolvedValue(true);
  mockLidarrPost.mockResolvedValue({ ok: false, status: 500, data: null });
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

  it("adds the album without triggering a Lidarr search", async () => {
    mockGetAlbumByMbid.mockResolvedValue({
      artist: { foreignArtistId: "artist-mbid" },
    });
    mockGetOrAddArtist.mockResolvedValue({ id: 1 });
    mockGetOrAddAlbum.mockResolvedValue({ album: { id: 10 } });
    mockLidarrGet.mockResolvedValue({
      ok: true,
      status: 200,
      data: [{ path: "/uploads/test/song.flac", name: "song.flac" }],
    });

    await scanUploadedFiles("mbid-1", "/uploads/test");

    expect(mockGetOrAddAlbum).toHaveBeenCalledWith(
      "mbid-1",
      { id: 1 },
      { search: false }
    );
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

describe("scanUploadedFiles identification", () => {
  const scanReady = () => {
    mockGetAlbumByMbid.mockResolvedValue({
      artist: { foreignArtistId: "artist-mbid" },
    });
    mockGetOrAddArtist.mockResolvedValue({ id: 1 });
    mockGetOrAddAlbum.mockResolvedValue({ album: { id: 10 } });
    mockLidarrGet.mockResolvedValue({
      ok: true,
      status: 200,
      data: [{ path: "/uploads/test/song.flac", name: "song.flac" }],
    });
  };

  it("waits for Lidarr to populate the album's tracks before scanning", async () => {
    scanReady();

    await scanUploadedFiles("mbid-1", "/uploads/test");

    expect(mockWaitForAlbumTracks).toHaveBeenCalledWith(10);
    expect(mockWaitForAlbumTracks.mock.invocationCallOrder[0]).toBeLessThan(
      mockLidarrGet.mock.invocationCallOrder[0]
    );
  });

  it("re-identifies the files against the album the user picked", async () => {
    scanReady();
    mockLidarrPost.mockResolvedValue({
      ok: true,
      status: 202,
      data: [
        {
          path: "/uploads/test/song.flac",
          name: "song.flac",
          artist: { id: 1 },
          album: { id: 10 },
          albumReleaseId: 55,
          tracks: [{ id: 3, title: "One", trackNumber: "1" }],
          quality: { quality: { id: 7, name: "FLAC" } },
        },
      ],
    });

    const result = await scanUploadedFiles("mbid-1", "/uploads/test");

    expect(mockLidarrPost).toHaveBeenCalledWith("/manualimport", [
      expect.objectContaining({
        path: "/uploads/test/song.flac",
        artistId: 1,
        albumId: 10,
      }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items[0].albumReleaseId).toBe(55);
      expect(result.items[0].tracks).toEqual([
        { id: 3, title: "One", trackNumber: "1" },
      ]);
    }
  });

  it("falls back to the raw scan when re-identification fails", async () => {
    scanReady();
    mockLidarrPost.mockResolvedValue({ ok: false, status: 500, data: null });

    const result = await scanUploadedFiles("mbid-1", "/uploads/test");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toEqual([
        { path: "/uploads/test/song.flac", name: "song.flac" },
      ]);
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
      releaseGroup: "SOMEGRP",
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
      quality: { quality: { name: "FLAC", id: 7, source: 1 }, revision: {} },
      releaseGroup: "SOMEGRP",
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

describe("findImportProblems", () => {
  it("accepts an item Lidarr fully matched", () => {
    expect(
      findImportProblems([completeItem] as Parameters<
        typeof findImportProblems
      >[0])
    ).toEqual([]);
  });

  it("reports every field Lidarr left unresolved", () => {
    const problems = findImportProblems([
      { path: "/imports/mystery.flac" },
    ] as Parameters<typeof findImportProblems>[0]);

    expect(problems).toHaveLength(1);
    expect(problems[0].path).toBe("/imports/mystery.flac");
    expect(problems[0].reason).toContain("artist");
    expect(problems[0].reason).toContain("album");
    expect(problems[0].reason).toContain("track match");
    expect(problems[0].reason).toContain("quality");
  });

  it("treats an Unknown quality as missing", () => {
    const problems = findImportProblems([
      { ...completeItem, quality: { quality: { id: 0, name: "Unknown" } } },
    ] as Parameters<typeof findImportProblems>[0]);

    expect(problems[0].reason).toContain("quality");
  });
});

describe("confirmImport", () => {
  it("sends the ManualImport command and waits for it to complete", async () => {
    mockLidarrPost.mockResolvedValue({
      ok: true,
      status: 201,
      data: { id: 42, name: "ManualImport", status: "queued" },
    });
    mockLidarrGet.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 42, name: "ManualImport", status: "completed" },
    });

    const items = [completeItem] as Parameters<typeof confirmImport>[0];

    const result = await confirmImport(items);

    expect(result).toEqual({ ok: true, pending: false });
    expect(mockLidarrPost).toHaveBeenCalledWith("/command", {
      name: "ManualImport",
      files: expect.arrayContaining([
        expect.objectContaining({ path: "/imports/song.flac" }),
      ]),
      importMode: "move",
    });
    expect(mockLidarrGet).toHaveBeenCalledWith("/command/42");
  });

  it("fails when the queued command finishes unsuccessfully", async () => {
    mockLidarrPost.mockResolvedValue({
      ok: true,
      status: 201,
      data: { id: 42, status: "queued" },
    });
    mockLidarrGet.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        id: 42,
        status: "completed",
        result: "unsuccessful",
        exception: "Sequence contains no matching element",
      },
    });

    const result = await confirmImport([completeItem] as Parameters<
      typeof confirmImport
    >[0]);

    expect(result).toEqual({
      ok: false,
      error: "Sequence contains no matching element",
    });
  });

  it("fails when the command itself fails", async () => {
    mockLidarrPost.mockResolvedValue({
      ok: true,
      status: 201,
      data: { id: 42, status: "queued" },
    });
    mockLidarrGet.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 42, status: "failed", exception: "boom" },
    });

    const result = await confirmImport([completeItem] as Parameters<
      typeof confirmImport
    >[0]);

    expect(result).toEqual({ ok: false, error: "boom" });
  });

  it("fails when Lidarr rejects the command outright", async () => {
    mockLidarrPost.mockResolvedValue({ ok: false, status: 400, data: null });

    const result = await confirmImport([completeItem] as Parameters<
      typeof confirmImport
    >[0]);

    expect(result.ok).toBe(false);
    expect(mockLidarrGet).not.toHaveBeenCalled();
  });
});
