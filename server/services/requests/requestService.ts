import { Brackets } from "typeorm";
import { getDataSource, Request } from "../../db/index";
import { hasPermission, Permission } from "../../../shared/permissions";
import { getAlbumByMbid } from "../lidarr/helpers";
import { fulfillRequest } from "./fulfillRequest";
import { createLogger } from "../../logger";
import {
  notifyRequestApproved,
  notifyRequestCreated,
  notifyRequestDeclined,
} from "../notifications";

type CreateRequestResult =
  | { status: "approved"; requestId: number }
  | { status: "pending"; requestId: number }
  | { status: "already_monitored"; requestId: number }
  | { status: "duplicate_pending"; requestId: number }
  | { status: "failed"; requestId: number };

type ApproveRequestResult =
  | { status: "approved" }
  | { status: "already_monitored" }
  | { status: "not_found" }
  | { status: "already_resolved" }
  | { status: "failed" };

const APPROVAL_STATUSES = new Set(["pending", "approved", "declined"]);

type DeclineRequestResult =
  | { status: "declined" }
  | { status: "not_found" }
  | { status: "already_resolved" };

const log = createLogger("requests");

function shouldAutoApprove(userPermissions: number): boolean {
  return hasPermission(userPermissions, [
    Permission.ADMIN,
    Permission.AUTO_APPROVE,
    Permission.MANAGE_REQUESTS,
  ]);
}

function getRequestRepo() {
  return getDataSource().getRepository(Request);
}

async function resolveAlbumInfo(
  albumMbid: string
): Promise<{ artistName: string; albumTitle: string }> {
  const lookupAlbum = await getAlbumByMbid(albumMbid);
  return {
    artistName: lookupAlbum.artist?.artistName ?? "Unknown Artist",
    albumTitle: lookupAlbum.title ?? "Unknown Album",
  };
}

export async function createRequest(
  userId: number,
  userPermissions: number,
  albumMbid: string
): Promise<CreateRequestResult> {
  const repo = getRequestRepo();

  const existingPending = await repo.findOne({
    where: { album_mbid: albumMbid, status: "pending" },
  });

  if (existingPending) {
    return { status: "duplicate_pending", requestId: existingPending.id };
  }

  const { artistName, albumTitle } = await resolveAlbumInfo(albumMbid);

  const request = repo.create({
    user_id: userId,
    album_mbid: albumMbid,
    artist_name: artistName,
    album_title: albumTitle,
    status: "pending",
  });

  const saved = await repo.save(request);
  log.info(`Request #${saved.id} created by user ${userId} for ${albumTitle}`);

  if (shouldAutoApprove(userPermissions)) {
    return processApproval(saved, userId);
  }

  // Only a request that still needs a decision is worth an admin's attention.
  void notifyRequestCreated(saved);

  return { status: "pending", requestId: saved.id };
}

async function processApproval(
  request: Request,
  approvedBy: number
): Promise<CreateRequestResult> {
  const repo = getRequestRepo();

  request.status = "approved";
  request.approved_by = approvedBy;
  request.approved_at = new Date().toISOString();

  try {
    const result = await fulfillRequest(request.album_mbid);
    await repo.save(request);

    log.info(`Request #${request.id} auto-approved and fulfilled`);

    if (result.status === "already_monitored") {
      return { status: "already_monitored", requestId: request.id };
    }

    return { status: "approved", requestId: request.id };
  } catch (err) {
    request.lidarr_status = "failed";
    await repo.save(request);
    log.error(`Failed to fulfill request #${request.id}: ${err}`);
    return { status: "failed", requestId: request.id };
  }
}

export async function approveRequest(
  requestId: number,
  approvedBy: number
): Promise<ApproveRequestResult> {
  const repo = getRequestRepo();

  const request = await repo.findOne({ where: { id: requestId } });

  if (!request) {
    return { status: "not_found" };
  }

  if (request.status !== "pending") {
    return { status: "already_resolved" };
  }

  request.status = "approved";
  request.approved_by = approvedBy;
  request.approved_at = new Date().toISOString();

  try {
    const result = await fulfillRequest(request.album_mbid);
    await repo.save(request);

    log.info(`Request #${requestId} approved by user ${approvedBy}`);
    void notifyRequestApproved(request);

    if (result.status === "already_monitored") {
      return { status: "already_monitored" };
    }

    return { status: "approved" };
  } catch (err) {
    request.lidarr_status = "failed";
    await repo.save(request);
    log.error(`Failed to fulfill request #${requestId}: ${err}`);
    return { status: "failed" };
  }
}

export async function declineRequest(
  requestId: number
): Promise<DeclineRequestResult> {
  const repo = getRequestRepo();

  const request = await repo.findOne({ where: { id: requestId } });

  if (!request) {
    return { status: "not_found" };
  }

  if (request.status !== "pending") {
    return { status: "already_resolved" };
  }

  request.status = "declined";
  await repo.save(request);

  log.info(`Request #${requestId} declined`);
  void notifyRequestDeclined(request);

  return { status: "declined" };
}

export async function getRequests(filters?: {
  status?: string[];
  userId?: number;
}) {
  const repo = getRequestRepo();

  const qb = repo
    .createQueryBuilder("request")
    .leftJoinAndSelect("request.user", "user")
    .orderBy("request.created_at", "DESC");

  if (filters?.userId) {
    qb.andWhere("request.user_id = :userId", { userId: filters.userId });
  }

  const statuses = filters?.status ?? [];
  if (statuses.length > 0) {
    const approvals = statuses.filter((s) => APPROVAL_STATUSES.has(s));
    const lifecycles = statuses.filter((s) => !APPROVAL_STATUSES.has(s));

    qb.andWhere(
      new Brackets((b) => {
        if (approvals.length > 0) {
          b.orWhere("request.status IN (:...approvals)", { approvals });
        }
        if (lifecycles.length > 0) {
          b.orWhere("request.lidarr_status IN (:...lifecycles)", {
            lifecycles,
          });
        }
      })
    );
  }

  return qb.getMany();
}
