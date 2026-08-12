import SettingsTabs, { type SettingsRoute } from "@/components/SettingsTabs";
import { BellIcon, EnvelopeIcon } from "@heroicons/react/24/solid";
import { Permission } from "@shared/permissions";

type NotificationsLayoutProps = {
  children: React.ReactNode;
};

const settingsRoutes: SettingsRoute[] = [
  {
    text: "Mine",
    content: (
      <span className="flex items-center gap-2">
        <BellIcon className="h-4 w-4" />
        Mine
      </span>
    ),
    route: "/settings/notifications/mine",
    regex: /^\/settings\/notifications\/mine/,
  },
  {
    text: "Email",
    content: (
      <span className="flex items-center gap-2">
        <EnvelopeIcon className="h-4 w-4" />
        Email
      </span>
    ),
    route: "/settings/notifications/email",
    regex: /^\/settings\/notifications\/email/,
    requiredPermission: Permission.ADMIN,
  },
  {
    text: "Webhook",
    content: (
      <span className="flex items-center gap-2">
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
        Webhook
      </span>
    ),
    route: "/settings/notifications/webhook",
    regex: /^\/settings\/notifications\/webhook/,
    requiredPermission: Permission.ADMIN,
  },
];

export default function NotificationsLayout({
  children,
}: NotificationsLayoutProps) {
  return (
    <>
      <div className="mb-6 hidden sm:block">
        <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Notification Settings
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Configure and enable notification agents.
        </p>
      </div>
      <SettingsTabs
        tabType="button"
        settingsRoutes={settingsRoutes}
        parentRoute="/settings/notifications"
        mobileBackLabel="Notifications"
        mobileListHeader={{
          backTo: "/settings",
          backLabel: "Settings",
          title: "Notifications",
          subtitle: "Configure and enable notification agents.",
        }}
      >
        {children}
      </SettingsTabs>
    </>
  );
}
