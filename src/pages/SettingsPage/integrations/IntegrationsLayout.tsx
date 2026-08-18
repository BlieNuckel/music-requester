import SettingsTabs, { type SettingsRoute } from "@/components/SettingsTabs";

type IntegrationsLayoutProps = {
  children: React.ReactNode;
};

/**
 * One group per external service. The page was a single scroll of every option
 * for every integration, which made finding one setting a hunt.
 */
const settingsRoutes: SettingsRoute[] = [
  {
    text: "Lidarr",
    route: "/settings/integrations/lidarr",
    regex: /^\/settings\/integrations\/lidarr/,
  },
  {
    text: "Soulseek",
    route: "/settings/integrations/soulseek",
    regex: /^\/settings\/integrations\/soulseek/,
  },
  {
    text: "Plex",
    route: "/settings/integrations/plex",
    regex: /^\/settings\/integrations\/plex/,
  },
  {
    text: "Last.fm",
    route: "/settings/integrations/lastfm",
    regex: /^\/settings\/integrations\/lastfm/,
  },
  {
    text: "Live events",
    route: "/settings/integrations/live-events",
    regex: /^\/settings\/integrations\/live-events/,
  },
];

export default function IntegrationsLayout({
  children,
}: IntegrationsLayoutProps) {
  return (
    <>
      <div className="mb-6 hidden sm:block">
        <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Integrations
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Connect the services Tunearr reads from and hands work to.
        </p>
      </div>
      <SettingsTabs
        tabType="button"
        settingsRoutes={settingsRoutes}
        parentRoute="/settings/integrations"
        mobileBackLabel="Integrations"
        mobileListHeader={{
          backTo: "/settings",
          backLabel: "Settings",
          title: "Integrations",
          subtitle:
            "Connect the services Tunearr reads from and hands work to.",
        }}
      >
        {children}
      </SettingsTabs>
    </>
  );
}
