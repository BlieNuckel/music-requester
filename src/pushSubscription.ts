export type PushPermission = "granted" | "denied" | "default" | "unavailable";

export type PushDevice = {
  id: number;
  endpoint: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
};

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);

  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

export function getPushPermission(): PushPermission {
  if (typeof Notification === "undefined") return "unavailable";
  return Notification.permission as PushPermission;
}

async function fetchPublicKey(): Promise<string> {
  const res = await fetch("/api/notifications/webpush/key");
  if (!res.ok) throw new Error("Could not load the server's push key");

  const { publicKey } = (await res.json()) as { publicKey: string };
  if (!publicKey) throw new Error("This server has no push key configured");

  return publicKey;
}

async function postSubscription(subscription: PushSubscription): Promise<void> {
  const res = await fetch("/api/notifications/webpush/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Could not register this device");
  }
}

/**
 * Asks for permission and registers this device. The caller must invoke this
 * from a user gesture: iOS only shows the permission prompt in response to one,
 * and a rejected prompt cannot be asked again.
 */
export async function subscribeToPush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted");
  }

  const publicKey = await fetchPublicKey();
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  await postSubscription(subscription);
}

/** Drops the browser-side subscription and the server row that mirrors it. */
export async function unsubscribeFromPush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  await fetch("/api/notifications/webpush/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });

  await subscription.unsubscribe();
}

export async function getCurrentEndpoint(): Promise<string | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription?.endpoint ?? null;
}
