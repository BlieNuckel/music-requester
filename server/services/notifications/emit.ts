import { findUserById } from "../../auth/users";
import { createLogger } from "../../logger";
import type { LidarrLifecycleStatus, Request } from "../../db/index";
import type { NotificationEventId } from "../../../shared/notificationEvents";
import { notifyAdmins, notifyUser } from "./dispatcher";
import type { NotificationMessage } from "./types";

type StatusCopy = {
  eventId: NotificationEventId;
  title: string;
  body: (album: string) => string;
};

export type FollowedReleaseNotification = {
  userId: number;
  artistName: string;
  artistMbid: string;
  albumTitle: string;
  releaseGroupMbid: string | null;
};

const REQUESTS_URL = "/library/requests";

/** Lidarr statuses that are worth telling someone about. `wanted` is not news. */
const STATUS_COPY: Partial<Record<LidarrLifecycleStatus, StatusCopy>> = {
  downloading: {
    eventId: "request.downloading",
    title: "Download started",
    body: (album) => `${album} is downloading now.`,
  },
  imported: {
    eventId: "request.imported",
    title: "Ready to play",
    body: (album) => `${album} is in your library.`,
  },
  failed: {
    eventId: "request.failed",
    title: "Request failed",
    body: (album) => `${album} could not be downloaded.`,
  },
};

const log = createLogger("Notifications");

function albumLabel(request: Request): string {
  return `${request.artist_name} – ${request.album_title}`;
}

/**
 * Emission is best effort by construction: a notification must never fail the
 * approval, import, or poll that produced it. The dispatcher already isolates
 * transport errors; this guards the lookups around them.
 */
async function safeNotify(send: () => Promise<void>): Promise<void> {
  try {
    await send();
  } catch (err) {
    log.warn(
      `Failed to emit notification: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

function requestMessage(
  request: Request,
  eventId: NotificationEventId,
  title: string,
  body: string
): NotificationMessage {
  return {
    eventId,
    title,
    body,
    url: REQUESTS_URL,
    data: { requestId: String(request.id), albumMbid: request.album_mbid },
  };
}

export function notifyRequestApproved(request: Request): Promise<void> {
  return safeNotify(() =>
    notifyUser(
      request.user_id,
      requestMessage(
        request,
        "request.approved",
        "Request approved",
        `${albumLabel(request)} is on its way.`
      )
    )
  );
}

export function notifyRequestDeclined(request: Request): Promise<void> {
  return safeNotify(() =>
    notifyUser(
      request.user_id,
      requestMessage(
        request,
        "request.declined",
        "Request declined",
        `${albumLabel(request)} was not approved.`
      )
    )
  );
}

/**
 * Announces a Lidarr lifecycle transition. Callers pass only requests whose
 * status actually changed, so an unchanged poll stays silent.
 */
export function notifyRequestStatus(
  request: Request,
  status: LidarrLifecycleStatus | null
): Promise<void> {
  const copy = status ? STATUS_COPY[status] : undefined;
  if (!copy) return Promise.resolve();

  return safeNotify(() =>
    notifyUser(
      request.user_id,
      requestMessage(
        request,
        copy.eventId,
        copy.title,
        copy.body(albumLabel(request))
      )
    )
  );
}

/** Tells admins a request needs a decision. Auto-approved requests do not. */
export function notifyRequestCreated(request: Request): Promise<void> {
  return safeNotify(async () => {
    const requester = await findUserById(request.user_id);
    const who = requester?.username ?? "Someone";

    await notifyAdmins({
      eventId: "request.created",
      title: "New request",
      body: `${who} requested ${albumLabel(request)}.`,
      url: REQUESTS_URL,
      data: { requestId: String(request.id) },
    });
  });
}

export function notifyFollowedRelease(
  release: FollowedReleaseNotification
): Promise<void> {
  const url = release.releaseGroupMbid
    ? `/album/${release.releaseGroupMbid}`
    : `/artist/${release.artistMbid}`;

  return safeNotify(() =>
    notifyUser(release.userId, {
      eventId: "followed.newRelease",
      title: `New from ${release.artistName}`,
      body: `${release.albumTitle} is out.`,
      url,
      data: { artistMbid: release.artistMbid },
    })
  );
}
