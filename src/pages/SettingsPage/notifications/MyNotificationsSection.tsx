import { useAuth } from "@/context/useAuth";
import useNotificationSettings from "@/hooks/useNotificationSettings";
import type {
  NotificationPreferenceEntry,
  NotificationTransportInfo,
} from "@/hooks/useNotificationSettings";
import { hasPermission, Permission } from "@shared/permissions";
import type {
  NotificationEventDefinition,
  NotificationEventId,
} from "@shared/notificationEvents";

type EventRowProps = {
  event: NotificationEventDefinition;
  transports: NotificationTransportInfo[];
  preferences: NotificationPreferenceEntry[];
  disabled: boolean;
  onToggle: (entry: NotificationPreferenceEntry) => void;
};

function isEnabled(
  preferences: NotificationPreferenceEntry[],
  eventId: NotificationEventId,
  transportId: string
): boolean {
  return (
    preferences.find(
      (p) => p.eventId === eventId && p.transportId === transportId
    )?.enabled ?? false
  );
}

function EventRow({
  event,
  transports,
  preferences,
  disabled,
  onToggle,
}: EventRowProps) {
  return (
    <div className="flex flex-col gap-3 p-4 bg-white dark:bg-gray-800 border-2 border-black rounded-lg shadow-cartoon-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
          {event.label}
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {event.description}
        </p>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        {transports.map((transport) => {
          const inputId = `${event.id}-${transport.id}`;
          return (
            <div key={transport.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                id={inputId}
                checked={isEnabled(preferences, event.id, transport.id)}
                disabled={disabled}
                onChange={(e) =>
                  onToggle({
                    eventId: event.id,
                    transportId: transport.id,
                    enabled: e.target.checked,
                  })
                }
                className="h-4 w-4 rounded border-2 border-black"
              />
              <label
                htmlFor={inputId}
                className="text-sm font-medium text-gray-900 dark:text-gray-100"
              >
                {transport.label}
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MyNotificationsSection() {
  const { user } = useAuth();
  const { settings, loading, error, saveError, saving, savePreference } =
    useNotificationSettings();

  if (loading) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Loading notification settings…
      </p>
    );
  }

  if (error || !settings) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        {error ?? "Failed to load notification settings"}
      </p>
    );
  }

  const isAdmin =
    user !== null && hasPermission(user.permissions, Permission.ADMIN);
  const events = settings.events.filter(
    (event) => event.audience === "user" || isAdmin
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          My notifications
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Choose what Tunearr tells you about, and where it sends it.
        </p>
      </div>

      {!settings.enabled && (
        <p className="p-4 text-sm font-medium bg-amber-100 dark:bg-amber-900/40 border-2 border-black rounded-lg">
          Notifications are switched off for this server. An admin can turn them
          back on in the notification settings.
        </p>
      )}

      {settings.transports.length === 0 ? (
        <p className="p-4 text-sm text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 border-2 border-black rounded-lg shadow-cartoon-sm">
          No delivery methods are set up yet. Once a notification method such as
          web push or email is configured, your choices will appear here.
        </p>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              transports={settings.transports}
              preferences={settings.preferences}
              disabled={saving}
              onToggle={savePreference}
            />
          ))}
        </div>
      )}

      {saveError && (
        <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>
      )}
    </div>
  );
}
