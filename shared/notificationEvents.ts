export type NotificationAudience = "user" | "admin";

export type NotificationEventId =
  | "request.approved"
  | "request.declined"
  | "request.downloading"
  | "request.imported"
  | "request.failed"
  | "followed.newRelease"
  | "discovery.weeklyReady"
  | "request.created"
  | "integration.unreachable"
  | "import.failed"
  | "live.quotaWarning"
  | "live.nearbyShow"
  | "live.statusChanged";

export type NotificationEventDefinition = {
  id: NotificationEventId;
  label: string;
  description: string;
  audience: NotificationAudience;
  defaultEnabled: boolean;
};

/**
 * The single catalog both sides agree on: the frontend renders preferences from
 * it and the dispatcher resolves recipients from `audience`. Adding an event here
 * is enough to make it selectable; no migration is involved because preferences
 * are stored sparsely as overrides of `defaultEnabled`.
 */
export const NOTIFICATION_EVENTS: readonly NotificationEventDefinition[] = [
  {
    id: "request.approved",
    label: "Request approved",
    description: "Someone approved a request you made.",
    audience: "user",
    defaultEnabled: true,
  },
  {
    id: "request.declined",
    label: "Request declined",
    description: "Someone declined a request you made.",
    audience: "user",
    defaultEnabled: true,
  },
  {
    id: "request.downloading",
    label: "Download started",
    description: "Lidarr started grabbing an album you requested.",
    audience: "user",
    defaultEnabled: false,
  },
  {
    id: "request.imported",
    label: "Available in your library",
    description: "An album you requested finished importing.",
    audience: "user",
    defaultEnabled: true,
  },
  {
    id: "request.failed",
    label: "Request failed",
    description: "An album you requested failed to download or import.",
    audience: "user",
    defaultEnabled: true,
  },
  {
    id: "followed.newRelease",
    label: "New release from a followed artist",
    description: "An artist you follow released something new.",
    audience: "user",
    defaultEnabled: true,
  },
  {
    id: "discovery.weeklyReady",
    label: "Weekly discoveries ready",
    description: "Your weekly set of recommendations has been generated.",
    audience: "user",
    defaultEnabled: false,
  },
  {
    id: "request.created",
    label: "New request submitted",
    description: "A user submitted a request that needs a decision.",
    audience: "admin",
    defaultEnabled: true,
  },
  {
    id: "live.nearbyShow",
    label: "Live dates near you",
    description: "An artist you follow announced a date you could get to.",
    audience: "user",
    defaultEnabled: true,
  },
  {
    id: "live.statusChanged",
    label: "Show cancelled or moved",
    description:
      "A show you were told about was cancelled, postponed, or rescheduled.",
    audience: "user",
    defaultEnabled: true,
  },
  {
    id: "live.quotaWarning",
    label: "Live events quota",
    description:
      "This instance is approaching, or has passed, its monthly live-events API allowance.",
    audience: "admin",
    defaultEnabled: true,
  },
  {
    id: "integration.unreachable",
    label: "Integration unreachable",
    description: "Lidarr, slskd, or Plex stopped responding.",
    audience: "admin",
    defaultEnabled: true,
  },
  {
    id: "import.failed",
    label: "Import failed",
    description: "An import or manual import failed.",
    audience: "admin",
    defaultEnabled: true,
  },
];

const EVENTS_BY_ID = new Map<string, NotificationEventDefinition>(
  NOTIFICATION_EVENTS.map((event) => [event.id, event])
);

export function isNotificationEventId(
  value: unknown
): value is NotificationEventId {
  return typeof value === "string" && EVENTS_BY_ID.has(value);
}

export function getNotificationEvent(
  id: NotificationEventId
): NotificationEventDefinition {
  const event = EVENTS_BY_ID.get(id);
  if (!event) {
    throw new Error(`Unknown notification event: ${id}`);
  }
  return event;
}

export function getEventsForAudience(
  audience: NotificationAudience
): NotificationEventDefinition[] {
  return NOTIFICATION_EVENTS.filter((event) => event.audience === audience);
}
