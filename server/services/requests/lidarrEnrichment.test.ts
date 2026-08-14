import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  LidarrQueueItem,
  LidarrWantedRecord,
  LidarrHistoryRecord,
} from "../../api/lidarr/types";

const mockLidarrGet = vi.fn();

vi.mock("../../api/lidarr/get", () => ({
  lidarrGet: (...args: unknown[]) => mockLidarrGet(...args),
}));

import {
  buildQueueMap,
  buildImportedMap,
  buildWantedMap,
  classifyRequest,
  enrichRequestsWithLidarr,
  invalidateLidarrData,
} from "./lidarrEnrichment";
import { buildLastEventMap } from "../lidarr/wanted";

beforeEach(() => {
  vi.clearAllMocks();
  invalidateLidarrData();
});

describe("buildQueueMap", () => {
  it("maps queue items by foreignAlbumId", () => {
    const items: LidarrQueueItem[] = [
      {
        id: 1,
        status: "downloading",
        title: "OK Computer",
        size: 500,
        sizeleft: 250,
        trackedDownloadStatus: "ok",
        artist: { artistName: "Radiohead" },
        album: { title: "OK Computer", foreignAlbumId: "mbid-1" },
        quality: { quality: { name: "FLAC" } },
      },
    ];

    const map = buildQueueMap(items);
    expect(map.size).toBe(1);
    expect(map.get("mbid-1")).toEqual({
      downloadProgress: 50,
      quality: "FLAC",
    });
  });

  it("skips items without foreignAlbumId", () => {
    const items = [
      {
        id: 1,
        status: "downloading",
        title: "Test",
        size: 100,
        sizeleft: 50,
        trackedDownloadStatus: "ok",
        artist: { artistName: "Artist" },
        album: { title: "Album", foreignAlbumId: "" },
        quality: { quality: { name: "MP3" } },
      },
    ] as LidarrQueueItem[];

    const map = buildQueueMap(items);
    expect(map.size).toBe(0);
  });

  it("calculates 0% progress when size is 0", () => {
    const items: LidarrQueueItem[] = [
      {
        id: 1,
        status: "downloading",
        title: "Test",
        size: 0,
        sizeleft: 0,
        trackedDownloadStatus: "ok",
        artist: { artistName: "Artist" },
        album: { title: "Album", foreignAlbumId: "mbid-1" },
        quality: { quality: { name: "FLAC" } },
      },
    ];

    const map = buildQueueMap(items);
    expect(map.get("mbid-1")?.downloadProgress).toBe(0);
  });
});

describe("buildImportedMap", () => {
  it("maps imported records by foreignAlbumId with indexer info", () => {
    const imported: LidarrHistoryRecord[] = [
      {
        id: 1,
        albumId: 10,
        eventType: 3,
        date: "2024-01-01",
        downloadId: "dl-1",
        data: {},
        artist: { id: 1, artistName: "Radiohead" },
        album: { id: 10, title: "OK Computer", foreignAlbumId: "mbid-1" },
      },
    ];
    const grabbed: LidarrHistoryRecord[] = [
      {
        id: 2,
        albumId: 10,
        eventType: 1,
        date: "2024-01-01",
        downloadId: "dl-1",
        data: { indexer: "Soulseek" },
        artist: { id: 1, artistName: "Radiohead" },
        album: { id: 10, title: "OK Computer", foreignAlbumId: "mbid-1" },
      },
    ];

    const map = buildImportedMap(imported, grabbed);
    expect(map.get("mbid-1")).toEqual({ sourceIndexer: "Soulseek" });
  });

  it("keeps only the first record per mbid", () => {
    const imported: LidarrHistoryRecord[] = [
      {
        id: 1,
        albumId: 10,
        eventType: 3,
        date: "2024-01-02",
        downloadId: "dl-1",
        data: {},
        artist: { id: 1, artistName: "Radiohead" },
        album: { id: 10, title: "OK Computer", foreignAlbumId: "mbid-1" },
      },
      {
        id: 2,
        albumId: 10,
        eventType: 3,
        date: "2024-01-01",
        downloadId: "dl-2",
        data: {},
        artist: { id: 1, artistName: "Radiohead" },
        album: { id: 10, title: "OK Computer", foreignAlbumId: "mbid-1" },
      },
    ];

    const map = buildImportedMap(imported, []);
    expect(map.size).toBe(1);
  });
});

describe("buildWantedMap", () => {
  it("maps wanted records with last event info", () => {
    const wanted: LidarrWantedRecord[] = [
      {
        id: 42,
        title: "In Rainbows",
        foreignAlbumId: "mbid-2",
        artist: { artistName: "Radiohead" },
      },
    ];
    const lastEventMap = buildLastEventMap([
      {
        id: 1,
        albumId: 42,
        eventType: 1,
        date: "2024-01-01",
        downloadId: "dl-1",
        data: {},
        artist: { id: 1, artistName: "Radiohead" },
        album: { id: 42, title: "In Rainbows", foreignAlbumId: "mbid-2" },
      },
    ]);

    const map = buildWantedMap(wanted, lastEventMap);
    expect(map.get("mbid-2")).toEqual({
      lastEvent: { eventType: 1, date: "2024-01-01" },
      lidarrAlbumId: 42,
    });
  });

  it("returns null lastEvent when no history exists", () => {
    const wanted: LidarrWantedRecord[] = [
      {
        id: 42,
        title: "In Rainbows",
        foreignAlbumId: "mbid-2",
        artist: { artistName: "Radiohead" },
      },
    ];

    const map = buildWantedMap(wanted, new Map());
    expect(map.get("mbid-2")?.lastEvent).toBeNull();
  });
});

describe("classifyRequest", () => {
  const emptyQueue = new Map();
  const emptyImported = new Map();
  const emptyWanted = new Map();

  it("returns downloading when in queue", () => {
    const queueMap = new Map([
      ["mbid-1", { downloadProgress: 50, quality: "FLAC" }],
    ]);

    const result = classifyRequest(
      "mbid-1",
      queueMap,
      emptyImported,
      emptyWanted
    );
    expect(result.status).toBe("downloading");
    expect(result.downloadProgress).toBe(50);
    expect(result.quality).toBe("FLAC");
  });

  it("returns imported when in history", () => {
    const importedMap = new Map([["mbid-1", { sourceIndexer: "Soulseek" }]]);

    const result = classifyRequest(
      "mbid-1",
      emptyQueue,
      importedMap,
      emptyWanted
    );
    expect(result.status).toBe("imported");
    expect(result.sourceIndexer).toBe("Soulseek");
  });

  it("returns wanted when in wanted list", () => {
    const wantedMap = new Map([
      [
        "mbid-1",
        { lastEvent: { eventType: 1, date: "2024-01-01" }, lidarrAlbumId: 42 },
      ],
    ]);

    const result = classifyRequest(
      "mbid-1",
      emptyQueue,
      emptyImported,
      wantedMap
    );
    expect(result.status).toBe("wanted");
    expect(result.lidarrAlbumId).toBe(42);
    expect(result.lastEvent).toEqual({ eventType: 1, date: "2024-01-01" });
  });

  it("returns null status when not found in any source", () => {
    const result = classifyRequest(
      "mbid-unknown",
      emptyQueue,
      emptyImported,
      emptyWanted
    );
    expect(result.status).toBeNull();
  });

  it("prioritizes downloading over imported", () => {
    const queueMap = new Map([
      ["mbid-1", { downloadProgress: 30, quality: "MP3" }],
    ]);
    const importedMap = new Map([["mbid-1", { sourceIndexer: "Soulseek" }]]);

    const result = classifyRequest(
      "mbid-1",
      queueMap,
      importedMap,
      emptyWanted
    );
    expect(result.status).toBe("downloading");
  });

  it("prioritizes imported over wanted", () => {
    const importedMap = new Map([["mbid-1", { sourceIndexer: null }]]);
    const wantedMap = new Map([
      ["mbid-1", { lastEvent: null, lidarrAlbumId: 42 }],
    ]);

    const result = classifyRequest(
      "mbid-1",
      emptyQueue,
      importedMap,
      wantedMap
    );
    expect(result.status).toBe("imported");
  });
});

describe("enrichRequestsWithLidarr", () => {
  function mockPaginatedResponse<T>(records: T[]) {
    return {
      status: 200,
      data: { page: 1, pageSize: 200, totalRecords: records.length, records },
      ok: true,
    };
  }

  it("enriches requests with Lidarr lifecycle data", async () => {
    mockLidarrGet.mockImplementation((path: string) => {
      if (path === "/queue") {
        return Promise.resolve(
          mockPaginatedResponse([
            {
              id: 1,
              status: "downloading",
              title: "OK Computer",
              size: 1000,
              sizeleft: 400,
              trackedDownloadStatus: "ok",
              artist: { artistName: "Radiohead" },
              album: { title: "OK Computer", foreignAlbumId: "mbid-1" },
              quality: { quality: { name: "FLAC" } },
            },
          ])
        );
      }
      return Promise.resolve(mockPaginatedResponse([]));
    });

    const results = await enrichRequestsWithLidarr(["mbid-1", "mbid-unknown"]);

    expect(results).toHaveLength(2);
    expect(results[0]?.status).toBe("downloading");
    expect(results[0]?.downloadProgress).toBe(60);
    expect(results[1]?.status).toBeNull();
  });

  it("returns null for all items when Lidarr is unavailable", async () => {
    mockLidarrGet.mockRejectedValue(new Error("Connection refused"));

    const results = await enrichRequestsWithLidarr(["mbid-1", "mbid-2"]);

    expect(results).toHaveLength(2);
    expect(results[0]).toBeNull();
    expect(results[1]).toBeNull();
  });

  it("reuses one Lidarr snapshot across calls", async () => {
    mockLidarrGet.mockResolvedValue(mockPaginatedResponse([]));

    await enrichRequestsWithLidarr(["mbid-1"]);
    const callsAfterFirst = mockLidarrGet.mock.calls.length;
    await enrichRequestsWithLidarr(["mbid-2"]);

    expect(mockLidarrGet).toHaveBeenCalledTimes(callsAfterFirst);
  });

  it("refetches the snapshot after invalidation", async () => {
    mockLidarrGet.mockResolvedValue(mockPaginatedResponse([]));

    await enrichRequestsWithLidarr(["mbid-1"]);
    const callsAfterFirst = mockLidarrGet.mock.calls.length;
    invalidateLidarrData();
    await enrichRequestsWithLidarr(["mbid-1"]);

    expect(mockLidarrGet).toHaveBeenCalledTimes(callsAfterFirst * 2);
  });

  it("does not cache a snapshot that failed to load", async () => {
    mockLidarrGet.mockRejectedValueOnce(new Error("Connection refused"));

    const failed = await enrichRequestsWithLidarr(["mbid-1"]);
    mockLidarrGet.mockResolvedValue(mockPaginatedResponse([]));
    const recovered = await enrichRequestsWithLidarr(["mbid-1"]);

    expect(failed[0]).toBeNull();
    expect(recovered[0]?.status).toBeNull();
  });
});
