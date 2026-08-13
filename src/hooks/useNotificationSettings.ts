import { useCallback, useState } from "react";
import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";
import type {
  NotificationEventDefinition,
  NotificationEventId,
} from "@shared/notificationEvents";

export type NotificationTransportInfo = {
  id: string;
  label: string;
  configured: boolean;
};

export type NotificationPreferenceEntry = {
  eventId: NotificationEventId;
  transportId: string;
  enabled: boolean;
};

export type NotificationSettings = {
  enabled: boolean;
  events: NotificationEventDefinition[];
  transports: NotificationTransportInfo[];
  preferences: NotificationPreferenceEntry[];
};

async function fetchNotificationSettings({
  signal,
}: FetchContext): Promise<NotificationSettings> {
  const [catalogRes, prefsRes] = await Promise.all([
    fetch("/api/notifications/catalog", { signal }),
    fetch("/api/notifications/preferences", { signal }),
  ]);

  if (!catalogRes.ok || !prefsRes.ok) {
    throw new Error("Failed to load notification settings");
  }

  const catalog = await catalogRes.json();
  const prefs = await prefsRes.json();

  return {
    enabled: catalog.enabled,
    events: catalog.events,
    transports: catalog.transports,
    preferences: prefs.preferences,
  };
}

async function putPreference(
  entry: NotificationPreferenceEntry
): Promise<NotificationPreferenceEntry[]> {
  const res = await fetch("/api/notifications/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preferences: [entry] }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to save notification preference");
  }

  const data = await res.json();
  return data.preferences;
}

export default function useNotificationSettings() {
  const { data, loading, error, refresh, setData } =
    useAsyncData<NotificationSettings>(
      "notification-settings",
      fetchNotificationSettings
    );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const savePreference = useCallback(
    async (entry: NotificationPreferenceEntry) => {
      setSaving(true);
      setSaveError(null);
      try {
        const preferences = await putPreference(entry);
        setData((prev) => ({ ...prev, preferences }));
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [setData]
  );

  return {
    settings: data,
    loading,
    error,
    saveError,
    saving,
    savePreference,
    refresh,
  };
}
