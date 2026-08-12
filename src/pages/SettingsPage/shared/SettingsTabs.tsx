import { useNavigate, useLocation } from "react-router-dom";
import { TAB_LABELS } from "../settingsSearchConfig";
import type { SettingsTab } from "../settingsSearchConfig";

interface SettingsTabsProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  visibleTabs: SettingsTab[];
}

export default function SettingsTabs({
  activeTab,
  onTabChange,
  visibleTabs,
}: SettingsTabsProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const isNotificationsActive = location.pathname.startsWith(
    "/settings/notifications"
  );

  const handleTabClick = (tabId: SettingsTab) => {
    if (tabId === "notifications") {
      navigate("/settings/notifications/mine");
    } else {
      onTabChange(tabId);
    }
  };

  return (
    <div
      className="flex gap-2 overflow-x-auto snap-x snap-mandatory overlay-scrollbar p-1"
      role="tablist"
    >
      {visibleTabs.map((tabId) => {
        const isActive =
          tabId === "notifications"
            ? isNotificationsActive
            : activeTab === tabId;

        return (
          <button
            key={tabId}
            role="tab"
            aria-selected={isActive}
            onClick={() => handleTabClick(tabId)}
            className={`shrink-0 snap-start px-4 py-2 text-sm font-bold rounded-lg border-2 border-black transition-all ${
              isActive
                ? "bg-pink-400 text-black shadow-cartoon-sm dark:text-black"
                : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-pink-50 dark:hover:bg-gray-700"
            }`}
          >
            {TAB_LABELS[tabId]}
          </button>
        );
      })}
    </div>
  );
}
