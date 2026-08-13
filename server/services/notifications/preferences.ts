import {
  findPreference,
  listPreferences,
  upsertPreferences,
} from "../../db/notificationPreferences";
import {
  NOTIFICATION_EVENTS,
  getNotificationEvent,
  isNotificationEventId,
  type NotificationEventId,
} from "../../../shared/notificationEvents";
import { getTransport, listSelectableTransports } from "./registry";
import type { PreferenceEntry } from "./types";

type OverrideKey = `${string}::${string}`;

function overrideKey(eventId: string, transportId: string): OverrideKey {
  return `${eventId}::${transportId}`;
}

async function loadOverrides(
  userId: number
): Promise<Map<OverrideKey, boolean>> {
  const rows = await listPreferences(userId);
  return new Map(
    rows.map((row) => [
      overrideKey(row.event_id, row.transport_id),
      row.enabled,
    ])
  );
}

/**
 * The full preference matrix for a user: every catalog event crossed with every
 * selectable transport, with stored overrides applied on top of each event's
 * `defaultEnabled`. Callers get a complete answer even for users who have never
 * saved anything.
 */
export async function getEffectivePreferences(
  userId: number
): Promise<PreferenceEntry[]> {
  const overrides = await loadOverrides(userId);
  const transports = listSelectableTransports();

  return NOTIFICATION_EVENTS.flatMap((event) =>
    transports.map((transport) => ({
      eventId: event.id,
      transportId: transport.id,
      enabled:
        overrides.get(overrideKey(event.id, transport.id)) ??
        event.defaultEnabled,
    }))
  );
}

export async function isEventEnabled(
  userId: number,
  eventId: NotificationEventId,
  transportId: string
): Promise<boolean> {
  const row = await findPreference(userId, eventId, transportId);
  return row ? row.enabled : getNotificationEvent(eventId).defaultEnabled;
}

function assertValidEntry(entry: PreferenceEntry): void {
  if (!isNotificationEventId(entry.eventId)) {
    throw new Error(`Unknown notification event: ${String(entry.eventId)}`);
  }
  if (!getTransport(entry.transportId)) {
    throw new Error(`Unknown notification transport: ${entry.transportId}`);
  }
  if (typeof entry.enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }
}

export async function setPreferences(
  userId: number,
  entries: PreferenceEntry[]
): Promise<PreferenceEntry[]> {
  entries.forEach(assertValidEntry);
  await upsertPreferences(userId, entries);
  return getEffectivePreferences(userId);
}
