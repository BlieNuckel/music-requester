import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFind = vi.fn();

vi.mock("../db/index", () => ({
  getDataSource: () => ({
    getRepository: () => ({
      find: (...args: unknown[]) => mockFind(...args),
    }),
  }),
  Request: "Request",
}));

vi.mock("../logger", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

const { mockEnrichRequestsWithLidarr } = await import("./mockLidarrEnrichment");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mockEnrichRequestsWithLidarr", () => {
  it("returns null for albums with no request row", async () => {
    mockFind.mockResolvedValue([]);

    const result = await mockEnrichRequestsWithLidarr(["mbid-a", "mbid-b"]);

    expect(result).toEqual([null, null]);
  });

  it("fabricates a lifecycle status only for requested albums", async () => {
    mockFind.mockResolvedValue([{ album_mbid: "mbid-b" }]);

    const result = await mockEnrichRequestsWithLidarr(["mbid-a", "mbid-b"]);

    expect(result[0]).toBeNull();
    expect(result[1]).not.toBeNull();
    expect(["downloading", "wanted", "imported", null]).toContain(
      result[1]!.status
    );
  });

  it("is deterministic per mbid", async () => {
    mockFind.mockResolvedValue([{ album_mbid: "mbid-a" }]);

    const first = await mockEnrichRequestsWithLidarr(["mbid-a"]);
    const second = await mockEnrichRequestsWithLidarr(["mbid-a"]);

    expect(first).toEqual(second);
  });

  it("skips the query entirely when given no mbids", async () => {
    const result = await mockEnrichRequestsWithLidarr([]);

    expect(result).toEqual([]);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("falls back to no statuses when the query fails", async () => {
    mockFind.mockRejectedValue(new Error("db closed"));

    const result = await mockEnrichRequestsWithLidarr(["mbid-a"]);

    expect(result).toEqual([null]);
  });
});
