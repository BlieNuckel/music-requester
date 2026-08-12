import { logTransport } from "./logTransport";
import { registerTransport } from "./registry";

export { notifyUser, notifyAdmins } from "./dispatcher";
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
export type {
  NotificationMessage,
  NotificationRecipient,
  NotificationTransport,
  PreferenceEntry,
  TransportInfo,
} from "./types";

/** Registers the built-in transports. Called once at boot from `server/index.ts`. */
export function initializeNotifications(): void {
  registerTransport(logTransport);
}
