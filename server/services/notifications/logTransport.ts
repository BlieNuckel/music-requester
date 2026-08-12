import { createLogger } from "../../logger";
import type {
  NotificationMessage,
  NotificationRecipient,
  NotificationTransport,
} from "./types";

const log = createLogger("Notifications");

/**
 * Always-on internal transport. It makes the dispatch path observable before any
 * real channel exists, and gives operators a record of what would have been sent
 * when every configured transport is down.
 */
export const logTransport: NotificationTransport = {
  id: "log",
  label: "Server log",
  internal: true,
  isConfigured: () => true,
  send: (recipient: NotificationRecipient, message: NotificationMessage) => {
    log.info(
      `[${message.eventId}] -> ${recipient.username ?? `user ${recipient.userId}`}: ${message.title}`
    );
    return Promise.resolve();
  },
};
