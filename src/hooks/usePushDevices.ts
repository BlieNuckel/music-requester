import { useCallback, useEffect, useState } from "react";
import useAsyncData from "./useAsyncData";
import {
  getCurrentEndpoint,
  getPushPermission,
  subscribeToPush,
  unsubscribeFromPush,
  type PushDevice,
  type PushPermission,
} from "@/pushSubscription";

export type PushDevicesState = {
  devices: PushDevice[];
  loading: boolean;
  error: string | null;
  actionError: string | null;
  busy: boolean;
  permission: PushPermission;
  /** Endpoint of the browser this page is running in, when it is subscribed. */
  currentEndpoint: string | null;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
  revoke: (id: number) => Promise<void>;
  sendTest: () => Promise<void>;
};

async function fetchDevices(): Promise<PushDevice[]> {
  const res = await fetch("/api/notifications/devices");
  if (!res.ok) throw new Error("Failed to load your devices");

  const data = (await res.json()) as { devices: PushDevice[] };
  return data.devices;
}

async function revokeDevice(id: number): Promise<void> {
  const res = await fetch(`/api/notifications/devices/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to remove that device");
}

async function postTest(): Promise<void> {
  const res = await fetch("/api/notifications/webpush/test", {
    method: "POST",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to send a test notification");
  }
}

export default function usePushDevices(enabled: boolean): PushDevicesState {
  const { data, loading, error, refresh } = useAsyncData<PushDevice[]>(
    enabled ? "push-devices" : null,
    fetchDevices
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] =
    useState<PushPermission>(getPushPermission);
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    void getCurrentEndpoint().then((endpoint) => {
      if (!cancelled) setCurrentEndpoint(endpoint);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, data]);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true);
      setActionError(null);
      try {
        await action();
        setPermission(getPushPermission());
        // The list catches up on its own; awaiting it here would keep the
        // buttons disabled for a round trip that the user does not care about.
        void refresh();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Something failed");
        setPermission(getPushPermission());
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const subscribe = useCallback(() => run(subscribeToPush), [run]);
  const unsubscribe = useCallback(() => run(unsubscribeFromPush), [run]);
  const revoke = useCallback(
    (id: number) => run(() => revokeDevice(id)),
    [run]
  );
  const sendTest = useCallback(() => run(postTest), [run]);

  return {
    devices: data ?? [],
    loading,
    error,
    actionError,
    busy,
    permission,
    currentEndpoint,
    subscribe,
    unsubscribe,
    revoke,
    sendTest,
  };
}
