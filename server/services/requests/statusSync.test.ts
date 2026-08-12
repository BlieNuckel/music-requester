import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFind = vi.fn();
const mockSave = vi.fn();
const mockFetchLidarrData = vi.fn();
const mockMockEnrich = vi.fn();
const mockNotifyStatus = vi.fn();

vi.mock("../../db/index", () => ({
  getDataSource: () => ({
    getRepository: () => ({
      find: (...args: unknown[]) => mockFind(...args),
      save: (...args: unknown[]) => mockSave(...args),
    }),
  }),
  Request: "Request",
}));

vi.mock("./lidarrEnrichment", async () => {
  const actual =
    await vi.importActual<typeof import("./lidarrEnrichment")>(
      "./lidarrEnrichment"
    );
  return {
    ...actual,
    fetchLidarrData: (...args: unknown[]) => mockFetchLidarrData(...args),
  };
});

vi.mock("../../dev/mockLidarrEnrichment", () => ({
  mockEnrichRequestsWithLidarr: (...args: unknown[]) => mockMockEnrich(...args),
}));

vi.mock("../notifications", () => ({
  notifyRequestStatus: (...args: unknown[]) => mockNotifyStatus(...args),
}));

vi.mock("../../logger", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

import { syncRequestStatuses } from "./statusSync";

function emptyMaps() {
  return { queueMap: new Map(), importedMap: new Map(), wantedMap: new Map() };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MOCK_LIDARR;
});

describe("syncRequestStatuses", () => {
  it("persists newly classified statuses for approved requests", async () => {
    mockFind.mockResolvedValue([
      { id: 1, album_mbid: "mbid-down", lidarr_status: null },
      { id: 2, album_mbid: "mbid-wanted", lidarr_status: null },
    ]);
    mockFetchLidarrData.mockResolvedValue({
      queueMap: new Map([
        ["mbid-down", { downloadProgress: 40, quality: "FLAC" }],
      ]),
      importedMap: new Map(),
      wantedMap: new Map([
        ["mbid-wanted", { lastEvent: null, lidarrAlbumId: 7 }],
      ]),
    });

    await syncRequestStatuses();

    expect(mockSave).toHaveBeenCalledTimes(1);
    const saved = mockSave.mock.calls[0][0] as {
      id: number;
      lidarr_status: string;
    }[];
    expect(saved).toEqual([
      expect.objectContaining({ id: 1, lidarr_status: "downloading" }),
      expect.objectContaining({ id: 2, lidarr_status: "wanted" }),
    ]);
  });

  it("does not save when no status changed", async () => {
    mockFind.mockResolvedValue([
      { id: 1, album_mbid: "mbid-down", lidarr_status: "downloading" },
    ]);
    mockFetchLidarrData.mockResolvedValue({
      queueMap: new Map([
        ["mbid-down", { downloadProgress: 40, quality: "FLAC" }],
      ]),
      importedMap: new Map(),
      wantedMap: new Map(),
    });

    await syncRequestStatuses();

    expect(mockSave).not.toHaveBeenCalled();
  });

  it("aborts without writing when the Lidarr fetch fails", async () => {
    mockFind.mockResolvedValue([
      { id: 1, album_mbid: "mbid-1", lidarr_status: "downloading" },
    ]);
    mockFetchLidarrData.mockRejectedValue(new Error("lidarr down"));

    await syncRequestStatuses();

    expect(mockSave).not.toHaveBeenCalled();
  });

  it("clears the status when Lidarr no longer knows the album", async () => {
    mockFind.mockResolvedValue([
      { id: 1, album_mbid: "mbid-gone", lidarr_status: "downloading" },
    ]);
    mockFetchLidarrData.mockResolvedValue(emptyMaps());

    await syncRequestStatuses();

    expect(mockSave).toHaveBeenCalledTimes(1);
    const saved = mockSave.mock.calls[0][0] as { lidarr_status: null }[];
    expect(saved[0].lidarr_status).toBeNull();
  });

  it("excludes terminal statuses from the candidate query", async () => {
    mockFind.mockResolvedValue([]);

    await syncRequestStatuses();

    const whereArg = mockFind.mock.calls[0][0] as { where: unknown };
    expect(whereArg.where).toBeDefined();
    expect(mockFetchLidarrData).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("uses the mock enrichment source in MOCK_LIDARR mode", async () => {
    process.env.MOCK_LIDARR = "true";
    mockFind.mockResolvedValue([
      { id: 1, album_mbid: "mbid-1", lidarr_status: null },
    ]);
    mockMockEnrich.mockResolvedValue([{ status: "imported" }]);

    await syncRequestStatuses();

    expect(mockFetchLidarrData).not.toHaveBeenCalled();
    const saved = mockSave.mock.calls[0][0] as { lidarr_status: string }[];
    expect(saved[0].lidarr_status).toBe("imported");
  });
});

describe("notifications", () => {
  it("announces each request whose status changed", async () => {
    const request = {
      id: 1,
      album_mbid: "mbid-1",
      lidarr_status: "downloading",
      user_id: 3,
    };
    mockFind.mockResolvedValue([request]);
    mockFetchLidarrData.mockResolvedValue({
      queueMap: new Map(),
      importedMap: new Map([["mbid-1", { id: 1 }]]),
      wantedMap: new Map(),
    });

    await syncRequestStatuses();

    expect(mockNotifyStatus).toHaveBeenCalledWith(request, "imported");
  });

  it("stays silent when a poll changes nothing", async () => {
    mockFind.mockResolvedValue([
      {
        id: 1,
        album_mbid: "mbid-1",
        lidarr_status: "downloading",
        user_id: 3,
      },
    ]);
    mockFetchLidarrData.mockResolvedValue({
      queueMap: new Map([["mbid-1", { id: 1 }]]),
      importedMap: new Map(),
      wantedMap: new Map(),
    });

    await syncRequestStatuses();

    expect(mockNotifyStatus).not.toHaveBeenCalled();
  });

  it("stays silent when Lidarr cannot be reached", async () => {
    mockFind.mockResolvedValue([
      { id: 1, album_mbid: "mbid-1", lidarr_status: null, user_id: 3 },
    ]);
    mockFetchLidarrData.mockRejectedValue(new Error("connection refused"));

    await syncRequestStatuses();

    expect(mockNotifyStatus).not.toHaveBeenCalled();
  });
});
