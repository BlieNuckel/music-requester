type BadgingNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/**
 * Mirrors the unseen count onto the installed app's icon. Badging is supported
 * only for installed web apps and is best effort everywhere else, so every path
 * here is a no-op rather than an error.
 */
export function syncAppBadge(count: number): void {
  if (typeof navigator === "undefined") return;

  const badging = navigator as BadgingNavigator;
  const result =
    count > 0 ? badging.setAppBadge?.(count) : badging.clearAppBadge?.();

  void result?.catch(() => {});
}
