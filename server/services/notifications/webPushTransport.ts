import webpush from "web-push";
import { createLogger } from "../../logger";
import {
  deleteSubscriptionByEndpoint,
  listSubscriptions,
} from "./pushSubscriptions";
import { getWebPushConfig, hasVapidKeys } from "./vapid";
import type {
  NotificationMessage,
  NotificationRecipient,
  NotificationTransport,
} from "./types";
import type { PushSubscription } from "../../db/index";

/** Statuses the push service uses to say an endpoint is permanently gone. */
const GONE_STATUSES = [404, 410];

/** Push payloads are capped around 4KB once encrypted; stay well inside it. */
const PAYLOAD_LIMIT = 3000;

/** A day-old "download started" helps nobody, so let the service drop it. */
const TTL_SECONDS = 24 * 60 * 60;

const log = createLogger("Notifications");

function buildPayload(message: NotificationMessage): string {
  const payload = {
    eventId: message.eventId,
    title: message.title,
    body: message.body,
    url: message.url ?? "/",
  };

  const serialized = JSON.stringify(payload);
  if (serialized.length <= PAYLOAD_LIMIT) return serialized;

  const overflow = serialized.length - PAYLOAD_LIMIT;
  return JSON.stringify({
    ...payload,
    body: `${payload.body.slice(0, Math.max(0, payload.body.length - overflow - 1))}…`,
  });
}

async function sendToSubscription(
  subscription: PushSubscription,
  payload: string
): Promise<void> {
  const config = getWebPushConfig();

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      payload,
      {
        TTL: TTL_SECONDS,
        vapidDetails: {
          subject: config.subject,
          publicKey: config.publicKey,
          privateKey: config.privateKey,
        },
      }
    );
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;

    if (status !== undefined && GONE_STATUSES.includes(status)) {
      await deleteSubscriptionByEndpoint(subscription.endpoint);
      log.info(`Pruned expired push subscription (${status})`);
      return;
    }

    log.warn(
      `Push delivery failed (${status ?? "no status"}): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

export const webPushTransport: NotificationTransport = {
  id: "webpush",
  label: "Web push",
  isConfigured: hasVapidKeys,
  send: async (
    recipient: NotificationRecipient,
    message: NotificationMessage
  ) => {
    const subscriptions = await listSubscriptions(recipient.userId);
    if (subscriptions.length === 0) return;

    const payload = buildPayload(message);
    await Promise.all(
      subscriptions.map((subscription) =>
        sendToSubscription(subscription, payload)
      )
    );
  },
};
