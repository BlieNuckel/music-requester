import usePushDevices from "@/hooks/usePushDevices";
import usePwaStatus from "@/hooks/usePwaStatus";
import describeDevice from "./describeDevice";
import type { PushDevice } from "@/pushSubscription";

type BlockedReason = {
  title: string;
  detail: string;
};

type DeviceRowProps = {
  device: PushDevice;
  isCurrent: boolean;
  disabled: boolean;
  onRevoke: (id: number) => void;
};

const CARD =
  "p-4 bg-white dark:bg-gray-800 border-2 border-black rounded-lg shadow-cartoon-sm";

const BUTTON =
  "px-4 py-2 font-bold rounded-lg border-2 border-black shadow-cartoon-sm hover:brightness-110 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

function DeviceRow({ device, isCurrent, disabled, onRevoke }: DeviceRowProps) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div>
        <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
          {describeDevice(device.userAgent)}
          {isCurrent && (
            <span className="ml-2 px-1.5 py-0.5 text-xs font-bold bg-amber-400 text-black border border-black rounded">
              This device
            </span>
          )}
        </p>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Last seen {new Date(device.lastSeenAt).toLocaleString()}
        </p>
      </div>
      <button
        onClick={() => onRevoke(device.id)}
        disabled={disabled}
        className={`${BUTTON} bg-rose-400 text-white text-sm`}
      >
        Remove
      </button>
    </li>
  );
}

function BlockedNotice({ title, detail }: BlockedReason) {
  return (
    <div className={CARD}>
      <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
        {title}
      </p>
      <p className="text-sm text-gray-600 dark:text-gray-400">{detail}</p>
    </div>
  );
}

export default function PushDevicesSection() {
  const { serviceWorkerSupport, requiresInstallForPush, platform } =
    usePwaStatus();
  const available =
    serviceWorkerSupport === "supported" && !requiresInstallForPush;
  const {
    devices,
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
  } = usePushDevices(available);

  const blocked = getBlockedReason(
    serviceWorkerSupport,
    requiresInstallForPush,
    platform,
    permission
  );
  const subscribedHere =
    currentEndpoint !== null &&
    devices.some((device) => device.endpoint === currentEndpoint);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
          Devices
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Push notifications arrive on the devices you turn on here.
        </p>
      </div>

      {blocked ? (
        <BlockedNotice title={blocked.title} detail={blocked.detail} />
      ) : (
        <div className={`${CARD} space-y-3`}>
          <div className="flex flex-wrap items-center gap-2">
            {subscribedHere ? (
              <>
                <button
                  onClick={unsubscribe}
                  disabled={busy}
                  className={`${BUTTON} bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100`}
                >
                  Turn off on this device
                </button>
                <button
                  onClick={sendTest}
                  disabled={busy}
                  className={`${BUTTON} bg-amber-400 text-black`}
                >
                  Send test notification
                </button>
              </>
            ) : (
              <button
                onClick={subscribe}
                disabled={busy}
                className={`${BUTTON} bg-amber-400 text-black`}
              >
                Turn on for this device
              </button>
            )}
          </div>

          {loading && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Loading your devices…
            </p>
          )}

          {!loading && devices.length > 0 && (
            <ul className="divide-y-2 divide-black/10 dark:divide-white/10">
              {devices.map((device) => (
                <DeviceRow
                  key={device.id}
                  device={device}
                  isCurrent={device.endpoint === currentEndpoint}
                  disabled={busy}
                  onRevoke={revoke}
                />
              ))}
            </ul>
          )}

          {!loading && devices.length === 0 && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              No devices yet.
            </p>
          )}
        </div>
      )}

      {(error || actionError) && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {actionError ?? error}
        </p>
      )}
    </div>
  );
}

function getBlockedReason(
  support: ReturnType<typeof usePwaStatus>["serviceWorkerSupport"],
  requiresInstall: boolean,
  platform: ReturnType<typeof usePwaStatus>["platform"],
  permission: ReturnType<typeof usePushDevices>["permission"]
): BlockedReason | null {
  if (support === "insecure-context") {
    return {
      title: "Push needs a secure connection",
      detail:
        "This page is served over plain HTTP, where browsers disable service workers. Reach Tunearr over HTTPS, for example through a reverse proxy or a tunnel, to enable notifications.",
    };
  }

  if (requiresInstall) {
    return {
      title: "Add Tunearr to your Home Screen first",
      detail:
        "On iPhone and iPad, notifications only work once Tunearr is installed. Tap Share, then Add to Home Screen, and open Tunearr from the icon.",
    };
  }

  if (support === "unsupported" || permission === "unavailable") {
    return {
      title: "This browser cannot show notifications",
      detail:
        platform === "ios"
          ? "Update to iOS 16.4 or later to use web notifications."
          : "Try a browser that supports the Push API, such as Chrome, Edge, or Firefox.",
    };
  }

  if (permission === "denied") {
    return {
      title: "Notifications are blocked",
      detail:
        "You previously denied notification permission for Tunearr. Re-allow it in your browser's site settings, then come back here.",
    };
  }

  return null;
}
