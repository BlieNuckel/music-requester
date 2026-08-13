import type { Request } from "../../db/index";
import {
  findPendingRequestForAlbum,
  findRequestById,
  insertRequest,
  listRequests,
  saveRequest,
} from "../../db/requests";
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
  const existingPending = await findPendingRequestForAlbum(albumMbid);
  if (existingPending) {
    return { status: "duplicate_pending", requestId: existingPending.id };
  }

  const { artistName, albumTitle } = await resolveAlbumInfo(albumMbid);

  const saved = await insertRequest({
    userId,
    albumMbid,
    artistName,
    albumTitle,
  });
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
  request.status = "approved";
  request.approved_by = approvedBy;
  request.approved_at = new Date().toISOString();

  try {
    const result = await fulfillRequest(request.album_mbid);
    await saveRequest(request);

    log.info(`Request #${request.id} auto-approved and fulfilled`);

    if (result.status === "already_monitored") {
      return { status: "already_monitored", requestId: request.id };
    }

    return { status: "approved", requestId: request.id };
  } catch (err) {
    request.lidarr_status = "failed";
    await saveRequest(request);
    log.error(`Failed to fulfill request #${request.id}: ${err}`);
    return { status: "failed", requestId: request.id };
  }
}

export async function approveRequest(
  requestId: number,
  approvedBy: number
): Promise<ApproveRequestResult> {
  const request = await findRequestById(requestId);

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
    await saveRequest(request);

    log.info(`Request #${requestId} approved by user ${approvedBy}`);
    void notifyRequestApproved(request);

    if (result.status === "already_monitored") {
      return { status: "already_monitored" };
    }

    return { status: "approved" };
  } catch (err) {
    request.lidarr_status = "failed";
    await saveRequest(request);
    log.error(`Failed to fulfill request #${requestId}: ${err}`);
    return { status: "failed" };
  }
}

export async function declineRequest(
  requestId: number
): Promise<DeclineRequestResult> {
  const request = await findRequestById(requestId);

  if (!request) {
    return { status: "not_found" };
  }

  if (request.status !== "pending") {
    return { status: "already_resolved" };
  }

  request.status = "declined";
  await saveRequest(request);

  log.info(`Request #${requestId} declined`);
  void notifyRequestDeclined(request);

  return { status: "declined" };
}

export async function getRequests(filters?: {
  status?: string[];
  userId?: number;
}) {
  return listRequests(filters, APPROVAL_STATUSES);
}
