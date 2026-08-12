import { findUserById, getAllUsers } from "../../auth/users";
import { getConfigValue } from "../../config";
import { createLogger } from "../../logger";
import { getNotificationEvent } from "../../../shared/notificationEvents";
import { hasPermission, Permission } from "../../../shared/permissions";
import { isEventEnabled } from "./preferences";
import { listTransports } from "./registry";
import type {
  NotificationMessage,
  NotificationRecipient,
  NotificationTransport,
} from "./types";

const log = createLogger("Notifications");

async function shouldSend(
  transport: NotificationTransport,
  recipient: NotificationRecipient,
  message: NotificationMessage
): Promise<boolean> {
  if (!transport.isConfigured()) return false;
  if (transport.internal) return true;
  return isEventEnabled(recipient.userId, message.eventId, transport.id);
}

/**
 * Delivery never propagates failure to the caller: a wedged SMTP server or a
 * dead push endpoint must not fail the request or import that triggered it.
 */
async function deliver(
  transport: NotificationTransport,
  recipient: NotificationRecipient,
  message: NotificationMessage
): Promise<void> {
  try {
    if (!(await shouldSend(transport, recipient, message))) return;
    await transport.send(recipient, message);
  } catch (err) {
    log.warn(
      `Transport ${transport.id} failed for ${message.eventId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

async function fanOut(
  recipients: NotificationRecipient[],
  message: NotificationMessage
): Promise<void> {
  if (!getConfigValue("notifications").enabled) return;

  const transports = listTransports();
  if (transports.length === 0 || recipients.length === 0) return;

  await Promise.all(
    recipients.flatMap((recipient) =>
      transports.map((transport) => deliver(transport, recipient, message))
    )
  );
}

export async function notifyUser(
  userId: number,
  message: NotificationMessage
): Promise<void> {
  if (getNotificationEvent(message.eventId).audience !== "user") {
    log.warn(`${message.eventId} is an admin event; use notifyAdmins`);
    return;
  }

  const user = await findUserById(userId);
  if (!user || !user.enabled) return;

  await fanOut([{ userId: user.id, username: user.username }], message);
}

export async function notifyAdmins(
  message: NotificationMessage
): Promise<void> {
  if (getNotificationEvent(message.eventId).audience !== "admin") {
    log.warn(`${message.eventId} is a user event; use notifyUser`);
    return;
  }

  const admins = (await getAllUsers()).filter(
    (user) => user.enabled && hasPermission(user.permissions, Permission.ADMIN)
  );

  await fanOut(
    admins.map((user) => ({ userId: user.id, username: user.username })),
    message
  );
}
