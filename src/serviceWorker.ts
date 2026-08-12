export type ServiceWorkerSupport =
  "supported" | "insecure-context" | "unsupported";

const SW_URL = "/sw.js";

/**
 * Why registration might not be possible. `insecure-context` is the common one
 * for self-hosted installs reached over plain HTTP on a LAN address: there is no
 * service worker there, so no web push either, and the UI needs to say so rather
 * than fail silently.
 */
export function getServiceWorkerSupport(): ServiceWorkerSupport {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return typeof window !== "undefined" && !window.isSecureContext
      ? "insecure-context"
      : "unsupported";
  }
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "insecure-context";
  }
  return "supported";
}

async function checkForUpdate(
  registration: ServiceWorkerRegistration
): Promise<void> {
  try {
    await registration.update();
  } catch {
    // A failed update check is not actionable — the next load retries anyway.
  }
}

/**
 * Registers the push service worker. Resolves to null (never throws) when the
 * environment cannot support one, so callers can fire and forget.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (getServiceWorkerSupport() !== "supported") return null;

  try {
    const registration = await navigator.serviceWorker.register(SW_URL);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void checkForUpdate(registration);
      }
    });

    return registration;
  } catch {
    return null;
  }
}
