import type { NotificationEventId } from "../../../shared/notificationEvents";

export type NotificationMessage = {
  eventId: NotificationEventId;
  title: string;
  body: string;
  /** App-relative path the notification should open, e.g. `/library/requests`. */
  url?: string;
  data?: Record<string, string>;
};

export type NotificationRecipient = {
  userId: number;
  username: string | null;
};

/**
 * Everything a delivery channel has to provide. Transports are registered at
 * boot and the dispatcher only ever talks to them through this shape, so adding
 * web push, email, or a webhook never touches dispatch logic.
 */
export type NotificationTransport = {
  id: string;
  label: string;
  /**
   * Internal transports are dispatched to but hidden from the preference UI —
   * the built-in logger uses this so it can never be switched off by a user.
   */
  internal?: boolean;
  isConfigured(): boolean;
  send(
    recipient: NotificationRecipient,
    message: NotificationMessage
  ): Promise<void>;
};

export type TransportInfo = {
  id: string;
  label: string;
  configured: boolean;
};

export type PreferenceEntry = {
  eventId: NotificationEventId;
  transportId: string;
  enabled: boolean;
};
