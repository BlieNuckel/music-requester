import { describe, it, expect, vi, beforeEach } from "vitest";
import { Brackets } from "typeorm";
import { Permission } from "../../../shared/permissions";

const mockFulfillRequest = vi.fn();
const mockGetAlbumByMbid = vi.fn();
const mockNotifyApproved = vi.fn();
const mockNotifyDeclined = vi.fn();
const mockNotifyCreated = vi.fn();

const mockFindOne = vi.fn();
const mockCreate = vi.fn();
const mockSave = vi.fn();
const mockGetMany = vi.fn();

/** Records calls made on the query builder so tests can assert filter SQL. */
const qbCalls = {
  andWhere: [] as { sql: unknown; params?: unknown }[],
  orWhere: [] as { sql: unknown; params?: unknown }[],
};

const subBuilder = {
  orWhere: (sql: unknown, params?: unknown) => {
    qbCalls.orWhere.push({ sql, params });
    return subBuilder;
  },
};

const queryBuilder = {
  leftJoinAndSelect: () => queryBuilder,
  orderBy: () => queryBuilder,
  andWhere: (sql: unknown, params?: unknown) => {
    if (sql instanceof Brackets) {
      (sql as unknown as { whereFactory: (b: unknown) => void }).whereFactory(
        subBuilder
      );
    } else {
      qbCalls.andWhere.push({ sql, params });
    }
    return queryBuilder;
  },
  getMany: (...args: unknown[]) => mockGetMany(...args),
};

vi.mock("../../db/index", () => ({
  getDataSource: () => ({
    getRepository: () => ({
      findOne: (...args: unknown[]) => mockFindOne(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      save: (...args: unknown[]) => mockSave(...args),
      createQueryBuilder: () => queryBuilder,
    }),
  }),
  Request: "Request",
}));

vi.mock("./fulfillRequest", () => ({
  fulfillRequest: (...args: unknown[]) => mockFulfillRequest(...args),
}));

vi.mock("../lidarr/helpers", () => ({
  getAlbumByMbid: (...args: unknown[]) => mockGetAlbumByMbid(...args),
}));

vi.mock("../notifications", () => ({
  notifyRequestApproved: (...args: unknown[]) => mockNotifyApproved(...args),
  notifyRequestDeclined: (...args: unknown[]) => mockNotifyDeclined(...args),
  notifyRequestCreated: (...args: unknown[]) => mockNotifyCreated(...args),
}));

vi.mock("../../logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

import {
  createRequest,
  approveRequest,
  declineRequest,
  getRequests,
} from "./requestService";

beforeEach(() => {
  vi.clearAllMocks();
  qbCalls.andWhere = [];
  qbCalls.orWhere = [];
  mockGetAlbumByMbid.mockResolvedValue({
    title: "Test Album",
    artist: { artistName: "Test Artist" },
  });
  mockNotifyApproved.mockResolvedValue(undefined);
  mockNotifyDeclined.mockResolvedValue(undefined);
  mockNotifyCreated.mockResolvedValue(undefined);
});

describe("createRequest", () => {
  it("returns duplicate_pending when a pending request exists for the album", async () => {
    mockFindOne.mockResolvedValue({ id: 5 });

    const result = await createRequest(1, Permission.REQUEST, "mbid-1");
    expect(result).toEqual({ status: "duplicate_pending", requestId: 5 });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates a pending request for a normal user", async () => {
    mockFindOne.mockResolvedValue(null);
    mockCreate.mockReturnValue({ user_id: 1, album_mbid: "mbid-1" });
    mockSave.mockResolvedValue({
      id: 10,
      user_id: 1,
      album_mbid: "mbid-1",
      status: "pending",
    });

    const result = await createRequest(1, Permission.REQUEST, "mbid-1");
    expect(result).toEqual({ status: "pending", requestId: 10 });
    expect(mockFulfillRequest).not.toHaveBeenCalled();
  });

  it("auto-approves for admin users", async () => {
    mockFindOne.mockResolvedValue(null);
    const savedRequest = {
      id: 10,
      user_id: 1,
      album_mbid: "mbid-1",
      status: "pending",
    };
    mockCreate.mockReturnValue(savedRequest);
    mockSave.mockResolvedValue(savedRequest);
    mockFulfillRequest.mockResolvedValue({
      status: "success",
      artistName: "Test Artist",
      albumTitle: "Test Album",
    });

    const result = await createRequest(1, Permission.ADMIN, "mbid-1");
    expect(result).toEqual({ status: "approved", requestId: 10 });
    expect(mockFulfillRequest).toHaveBeenCalledWith("mbid-1");
  });

  it("auto-approves for users with AUTO_APPROVE permission", async () => {
    mockFindOne.mockResolvedValue(null);
    const savedRequest = {
      id: 10,
      user_id: 1,
      album_mbid: "mbid-1",
      status: "pending",
    };
    mockCreate.mockReturnValue(savedRequest);
    mockSave.mockResolvedValue(savedRequest);
    mockFulfillRequest.mockResolvedValue({
      status: "success",
      artistName: "Test Artist",
      albumTitle: "Test Album",
    });

    const result = await createRequest(
      1,
      Permission.REQUEST | Permission.AUTO_APPROVE,
      "mbid-1"
    );
    expect(result).toEqual({ status: "approved", requestId: 10 });
  });

  it("auto-approves for users with MANAGE_REQUESTS permission", async () => {
    mockFindOne.mockResolvedValue(null);
    const savedRequest = {
      id: 10,
      user_id: 1,
      album_mbid: "mbid-1",
      status: "pending",
    };
    mockCreate.mockReturnValue(savedRequest);
    mockSave.mockResolvedValue(savedRequest);
    mockFulfillRequest.mockResolvedValue({
      status: "success",
      artistName: "Test Artist",
      albumTitle: "Test Album",
    });

    const result = await createRequest(
      1,
      Permission.REQUEST | Permission.MANAGE_REQUESTS,
      "mbid-1"
    );
    expect(result).toEqual({ status: "approved", requestId: 10 });
    expect(mockFulfillRequest).toHaveBeenCalledWith("mbid-1");
  });

  it("returns already_monitored when auto-approve finds existing album", async () => {
    mockFindOne.mockResolvedValue(null);
    const savedRequest = {
      id: 10,
      user_id: 1,
      album_mbid: "mbid-1",
      status: "pending",
    };
    mockCreate.mockReturnValue(savedRequest);
    mockSave.mockResolvedValue(savedRequest);
    mockFulfillRequest.mockResolvedValue({
      status: "already_monitored",
      artistName: "Test Artist",
      albumTitle: "Test Album",
    });

    const result = await createRequest(1, Permission.ADMIN, "mbid-1");
    expect(result).toEqual({ status: "already_monitored", requestId: 10 });
  });

  it("marks lidarr_status failed when auto-approve fulfillment throws", async () => {
    mockFindOne.mockResolvedValue(null);
    const savedRequest = {
      id: 10,
      user_id: 1,
      album_mbid: "mbid-1",
      status: "pending",
    } as Record<string, unknown>;
    mockCreate.mockReturnValue(savedRequest);
    mockSave.mockResolvedValue(savedRequest);
    mockFulfillRequest.mockRejectedValue(new Error("lidarr boom"));

    const result = await createRequest(1, Permission.ADMIN, "mbid-1");

    expect(result).toEqual({ status: "failed", requestId: 10 });
    expect(savedRequest.status).toBe("approved");
    expect(savedRequest.lidarr_status).toBe("failed");
  });
});

describe("approveRequest", () => {
  it("returns not_found when request does not exist", async () => {
    mockFindOne.mockResolvedValue(null);
    const result = await approveRequest(999, 1);
    expect(result).toEqual({ status: "not_found" });
  });

  it("returns already_resolved when request is not pending", async () => {
    mockFindOne.mockResolvedValue({ id: 1, status: "approved" });
    const result = await approveRequest(1, 1);
    expect(result).toEqual({ status: "already_resolved" });
  });

  it("approves a pending request", async () => {
    const req = { id: 1, status: "pending", album_mbid: "mbid-1" };
    mockFindOne.mockResolvedValue(req);
    mockSave.mockResolvedValue(req);
    mockFulfillRequest.mockResolvedValue({
      status: "success",
      artistName: "Test Artist",
      albumTitle: "Test Album",
    });

    const result = await approveRequest(1, 2);
    expect(result).toEqual({ status: "approved" });
    expect(req.status).toBe("approved");
    expect(mockFulfillRequest).toHaveBeenCalledWith("mbid-1");
  });

  it("marks lidarr_status failed when fulfillment throws", async () => {
    const req = {
      id: 1,
      status: "pending",
      album_mbid: "mbid-1",
    } as Record<string, unknown>;
    mockFindOne.mockResolvedValue(req);
    mockSave.mockResolvedValue(req);
    mockFulfillRequest.mockRejectedValue(new Error("lidarr boom"));

    const result = await approveRequest(1, 2);

    expect(result).toEqual({ status: "failed" });
    expect(req.status).toBe("approved");
    expect(req.lidarr_status).toBe("failed");
  });
});

describe("declineRequest", () => {
  it("returns not_found when request does not exist", async () => {
    mockFindOne.mockResolvedValue(null);
    const result = await declineRequest(999);
    expect(result).toEqual({ status: "not_found" });
  });

  it("returns already_resolved when request is not pending", async () => {
    mockFindOne.mockResolvedValue({ id: 1, status: "approved" });
    const result = await declineRequest(1);
    expect(result).toEqual({ status: "already_resolved" });
  });

  it("declines a pending request", async () => {
    const req = { id: 1, status: "pending" };
    mockFindOne.mockResolvedValue(req);
    mockSave.mockResolvedValue(req);

    const result = await declineRequest(1);
    expect(result).toEqual({ status: "declined" });
    expect(req.status).toBe("declined");
  });
});

describe("getRequests", () => {
  it("returns requests with no filters applied", async () => {
    mockGetMany.mockResolvedValue([]);
    const result = await getRequests();
    expect(result).toEqual([]);
    expect(qbCalls.andWhere).toHaveLength(0);
    expect(qbCalls.orWhere).toHaveLength(0);
  });

  it("filters approval statuses on the status column", async () => {
    mockGetMany.mockResolvedValue([]);
    await getRequests({ status: ["pending", "approved"] });

    expect(qbCalls.orWhere).toEqual([
      {
        sql: "request.status IN (:...approvals)",
        params: { approvals: ["pending", "approved"] },
      },
    ]);
  });

  it("filters lifecycle statuses on the lidarr_status column", async () => {
    mockGetMany.mockResolvedValue([]);
    await getRequests({ status: ["downloading", "imported"] });

    expect(qbCalls.orWhere).toEqual([
      {
        sql: "request.lidarr_status IN (:...lifecycles)",
        params: { lifecycles: ["downloading", "imported"] },
      },
    ]);
  });

  it("ORs approval and lifecycle statuses across both columns", async () => {
    mockGetMany.mockResolvedValue([]);
    await getRequests({ status: ["approved", "failed", "wanted"] });

    expect(qbCalls.orWhere).toEqual([
      {
        sql: "request.status IN (:...approvals)",
        params: { approvals: ["approved"] },
      },
      {
        sql: "request.lidarr_status IN (:...lifecycles)",
        params: { lifecycles: ["failed", "wanted"] },
      },
    ]);
  });

  it("does not add a status filter when the array is empty", async () => {
    mockGetMany.mockResolvedValue([]);
    await getRequests({ status: [] });
    expect(qbCalls.orWhere).toHaveLength(0);
  });

  it("filters by userId", async () => {
    mockGetMany.mockResolvedValue([]);
    await getRequests({ userId: 5 });
    expect(qbCalls.andWhere).toEqual([
      { sql: "request.user_id = :userId", params: { userId: 5 } },
    ]);
  });
});

describe("notifications", () => {
  it("tells admins about a request that needs a decision", async () => {
    const saved = { id: 10, user_id: 1, album_mbid: "mbid-1" };
    mockFindOne.mockResolvedValue(null);
    mockCreate.mockReturnValue({ user_id: 1, album_mbid: "mbid-1" });
    mockSave.mockResolvedValue(saved);

    await createRequest(1, Permission.REQUEST, "mbid-1");

    expect(mockNotifyCreated).toHaveBeenCalledWith(saved);
  });

  it("stays quiet when the request auto-approves, since there is nothing to decide", async () => {
    mockFindOne.mockResolvedValue(null);
    mockCreate.mockReturnValue({ user_id: 1, album_mbid: "mbid-1" });
    mockSave.mockResolvedValue({ id: 10, user_id: 1, album_mbid: "mbid-1" });
    mockFulfillRequest.mockResolvedValue({ status: "added" });

    await createRequest(1, Permission.AUTO_APPROVE, "mbid-1");

    expect(mockNotifyCreated).not.toHaveBeenCalled();
  });

  it("notifies the requester when an admin approves", async () => {
    const request = { id: 5, user_id: 3, status: "pending" };
    mockFindOne.mockResolvedValue(request);
    mockFulfillRequest.mockResolvedValue({ status: "added" });
    mockSave.mockResolvedValue(request);

    await approveRequest(5, 1);

    expect(mockNotifyApproved).toHaveBeenCalledWith(request);
  });

  it("does not notify when fulfilment fails", async () => {
    const request = { id: 5, user_id: 3, status: "pending" };
    mockFindOne.mockResolvedValue(request);
    mockFulfillRequest.mockRejectedValue(new Error("lidarr is down"));
    mockSave.mockResolvedValue(request);

    await approveRequest(5, 1);

    expect(mockNotifyApproved).not.toHaveBeenCalled();
  });

  it("notifies the requester when an admin declines", async () => {
    const request = { id: 5, user_id: 3, status: "pending" };
    mockFindOne.mockResolvedValue(request);
    mockSave.mockResolvedValue(request);

    await declineRequest(5);

    expect(mockNotifyDeclined).toHaveBeenCalledWith(request);
  });

  it("does not notify when the request was already resolved", async () => {
    mockFindOne.mockResolvedValue({ id: 5, user_id: 3, status: "approved" });

    await declineRequest(5);
    await approveRequest(5, 1);

    expect(mockNotifyDeclined).not.toHaveBeenCalled();
    expect(mockNotifyApproved).not.toHaveBeenCalled();
  });
});
