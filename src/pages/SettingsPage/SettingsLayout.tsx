import { Outlet, useLocation } from "react-router-dom";
import SettingsTabs from "@/components/SettingsTabs";
import type { SettingsRoute } from "@/components/SettingsTabs";
import { Permission } from "@shared/permissions";
import useIsMobile from "@/hooks/useIsMobile";

const settingsRoutes: SettingsRoute[] = [
  {
    text: "General",
    route: "/settings/general",
    regex: /^\/settings\/general/,
  },
  {
    text: "Integrations",
    route: "/settings/integrations",
    regex: /^\/settings\/integrations/,
    requiredPermission: Permission.ADMIN,
    skipMobileHeader: true,
  },
  {
    text: "Recommendations",
    route: "/settings/recommendations",
    regex: /^\/settings\/recommendations/,
    requiredPermission: Permission.ADMIN,
  },
  {
    text: "Purchase",
    route: "/settings/purchase-decision",
    regex: /^\/settings\/purchase-decision/,
    requiredPermission: Permission.ADMIN,
  },
  {
    text: "Notifications",
    route: "/settings/notifications",
    regex: /^\/settings\/notifications/,
    skipMobileHeader: true,
  },
  {
    text: "Users",
    route: "/settings/users",
    regex: /^\/settings\/users/,
    requiredPermission: Permission.MANAGE_USERS,
  },
  {
    text: "Logs",
    route: "/settings/logs",
    regex: /^\/settings\/logs/,
    requiredPermission: Permission.ADMIN,
  },
];

export default function SettingsLayout() {
  const isMobile = useIsMobile();
  const location = useLocation();

  const hasActiveChild = settingsRoutes.some((r) =>
    r.regex.test(location.pathname)
  );

  return (
    <div className="space-y-6">
      {!(isMobile && hasActiveChild) && (
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Settings
          </h1>
        </div>
      )}

      <SettingsTabs
        settingsRoutes={settingsRoutes}
        parentRoute="/settings"
        mobileBackLabel="Settings"
      >
        <Outlet />
      </SettingsTabs>
    </div>
  );
}
