import { logTransport } from "./logTransport";
import { registerTransport } from "./registry";
import { ensureVapidKeys } from "./vapid";
import { webPushTransport } from "./webPushTransport";

export { notifyUser, notifyAdmins } from "./dispatcher";
export {
  notifyFollowedRelease,
  notifyRequestApproved,
  notifyRequestCreated,
  notifyRequestDeclined,
  notifyRequestStatus,
} from "./emit";
export type { FollowedReleaseNotification } from "./emit";
export type { QuotaWarningNotification } from "./emit";
export { notifyQuotaWarning } from "./emit";
export {
  getEffectivePreferences,
  isEventEnabled,
  setPreferences,
} from "./preferences";
export {
  describeSelectableTransports,
  getTransport,
  listSelectableTransports,
  listTransports,
  registerTransport,
} from "./registry";
export {
  deleteSubscriptionByEndpoint,
  deleteSubscriptionForUser,
  listSubscriptions,
  saveSubscription,
  toPushDevice,
} from "../../db/pushSubscriptions";
export type {
  PushDevice,
  PushSubscriptionInput,
} from "../../db/pushSubscriptions";
export { getWebPushConfig, hasVapidKeys } from "./vapid";
export { webPushTransport } from "./webPushTransport";
export type {
  NotificationMessage,
  NotificationRecipient,
  NotificationTransport,
  PreferenceEntry,
  TransportInfo,
} from "./types";

/** Registers the built-in transports. Called once at boot from `server/index.ts`. */
export function initializeNotifications(): void {
  ensureVapidKeys();
  registerTransport(logTransport);
  registerTransport(webPushTransport);
}
