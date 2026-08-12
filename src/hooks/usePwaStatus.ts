import { useEffect, useState } from "react";
import {
  getServiceWorkerSupport,
  type ServiceWorkerSupport,
} from "@/serviceWorker";

export type PwaPlatform = "ios" | "android" | "other";

export type PwaStatus = {
  /** Running as an installed app rather than a browser tab. */
  isStandalone: boolean;
  platform: PwaPlatform;
  serviceWorkerSupport: ServiceWorkerSupport;
  /**
   * iOS exposes Web Push only to home-screen installs, so a Safari tab needs an
   * "add to Home Screen" prompt instead of a permission button.
   */
  requiresInstallForPush: boolean;
};

const STANDALONE_QUERY = "(display-mode: standalone)";

function detectPlatform(): PwaPlatform {
  if (typeof navigator === "undefined") return "other";

  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPad|iPhone|iPod/i.test(ua)) return "ios";

  // iPadOS reports a desktop Safari UA; touch points are what separates it.
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return "ios";

  return "other";
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;

  const iosStandalone = (navigator as Navigator & { standalone?: boolean })
    .standalone;
  return (
    window.matchMedia?.(STANDALONE_QUERY).matches === true ||
    iosStandalone === true
  );
}

export default function usePwaStatus(): PwaStatus {
  const [isStandalone, setIsStandalone] = useState(detectStandalone);

  useEffect(() => {
    const query = window.matchMedia?.(STANDALONE_QUERY);
    if (!query) return;

    const onChange = (event: MediaQueryListEvent) =>
      setIsStandalone(event.matches || detectStandalone());
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const platform = detectPlatform();

  return {
    isStandalone,
    platform,
    serviceWorkerSupport: getServiceWorkerSupport(),
    requiresInstallForPush: platform === "ios" && !isStandalone,
  };
}
