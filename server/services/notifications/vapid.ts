import webpush from "web-push";
import { getConfigValue, setConfig } from "../../config";
import { createLogger } from "../../logger";
import type { WebPushConfig } from "../../config";

const log = createLogger("Notifications");

export function getWebPushConfig(): WebPushConfig {
  return getConfigValue("notifications").webPush;
}

export function hasVapidKeys(): boolean {
  const { publicKey, privateKey } = getWebPushConfig();
  return publicKey !== "" && privateKey !== "";
}

/**
 * Generates the VAPID keypair on first boot and persists it. Keys are never
 * rotated automatically: every stored subscription is bound to the public key it
 * was created with, so replacing the pair would silently break every device.
 */
export function ensureVapidKeys(): void {
  if (hasVapidKeys()) return;

  const { publicKey, privateKey } = webpush.generateVAPIDKeys();
  setConfig({ notifications: { webPush: { publicKey, privateKey } } });
  log.info("Generated VAPID keypair for web push");
}
