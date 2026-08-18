import { hasPermission, Permission } from "@shared/permissions";

export type SettingsTab =
  | "general"
  | "integrations"
  | "recommendations"
  | "purchaseDecision"
  | "notifications"
  | "admin"
  | "logs"
  | "tasteProfiles";

export const TAB_LABELS: Record<SettingsTab, string> = {
  general: "General",
  integrations: "Integrations",
  recommendations: "Recommendations",
  purchaseDecision: "Purchase",
  notifications: "Notifications",
  admin: "Users",
  logs: "Logs",
  tasteProfiles: "Profiles",
};

export type SettingsSection =
  | "account"
  | "theme"
  | "import"
  | "lidarrConnection"
  | "lidarrOptions"
  | "lastfm"
  | "liveEvents"
  | "livePreferences"
  | "plex"
  | "slskd"
  | "recommendations"
  | "purchaseDecision"
  | "users"
  | "myNotifications"
  | "logs"
  | "tasteProfiles";

type SectionMeta = {
  label: string;
  tab: SettingsTab;
  keywords: string[];
  permission?: Permission;
};

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  account: {
    label: "Account",
    tab: "general",
    keywords: [
      "account",
      "user",
      "logout",
      "sign out",
      "username",
      "permissions",
    ],
  },
  theme: {
    label: "Theme",
    tab: "general",
    keywords: ["theme", "dark", "light", "mode", "appearance", "system"],
  },
  import: {
    label: "Manual Import",
    tab: "integrations",
    keywords: ["import", "path", "upload", "file", "manual"],
    permission: Permission.ADMIN,
  },
  lidarrConnection: {
    label: "Lidarr Connection",
    tab: "integrations",
    keywords: ["lidarr", "url", "api", "key", "connection", "test"],
    permission: Permission.ADMIN,
  },
  lidarrOptions: {
    label: "Lidarr Options",
    tab: "integrations",
    keywords: [
      "lidarr",
      "quality",
      "profile",
      "root",
      "folder",
      "metadata",
      "path",
    ],
    permission: Permission.ADMIN,
  },
  liveEvents: {
    label: "Live events",
    tab: "integrations",
    keywords: [
      "live",
      "events",
      "tour",
      "dates",
      "concerts",
      "shows",
      "gigs",
      "jambase",
      "radius",
      "countries",
    ],
    permission: Permission.ADMIN,
  },
  livePreferences: {
    label: "Live dates",
    tab: "general",
    keywords: [
      "live",
      "dates",
      "tour",
      "shows",
      "gigs",
      "banner",
      "radius",
      "countries",
      "nearby",
    ],
  },
  lastfm: {
    label: "Last.fm",
    tab: "integrations",
    keywords: ["lastfm", "last.fm", "scrobble", "api", "key"],
    permission: Permission.ADMIN,
  },
  plex: {
    label: "Plex",
    tab: "integrations",
    keywords: ["plex", "media", "server", "login", "token"],
    permission: Permission.ADMIN,
  },
  slskd: {
    label: "slskd",
    tab: "integrations",
    keywords: [
      "slskd",
      "soulseek",
      "download",
      "api",
      "key",
      "path",
      "indexer",
      "torznab",
      "sabnzbd",
    ],
    permission: Permission.ADMIN,
  },
  recommendations: {
    label: "Recommendations",
    tab: "recommendations",
    keywords: [
      "recommendation",
      "promoted",
      "algorithm",
      "cache",
      "tags",
      "discovery",
      "artist",
      "library",
      "preference",
      "generic",
      "plays",
      "one-hit",
    ],
    permission: Permission.ADMIN,
  },
  purchaseDecision: {
    label: "Purchase Decision",
    tab: "purchaseDecision",
    keywords: [
      "purchase",
      "buy",
      "label",
      "blocklist",
      "block",
      "major",
      "indie",
      "decision",
      "age",
      "new release",
      "threshold",
    ],
    permission: Permission.ADMIN,
  },
  users: {
    label: "User Management",
    tab: "admin",
    keywords: [
      "user",
      "users",
      "manage",
      "admin",
      "permission",
      "create",
      "delete",
      "role",
    ],
    permission: Permission.MANAGE_USERS,
  },
  myNotifications: {
    label: "My Notifications",
    tab: "notifications",
    keywords: [
      "notification",
      "notifications",
      "alerts",
      "push",
      "email",
      "subscribe",
      "mine",
    ],
  },
  logs: {
    label: "Logs",
    tab: "logs",
    keywords: ["logs", "log", "debug", "error", "history", "system"],
    permission: Permission.ADMIN,
  },
  tasteProfiles: {
    label: "Taste profiles",
    tab: "tasteProfiles",
    keywords: [
      "taste",
      "profile",
      "profiles",
      "signals",
      "plays",
      "ratings",
      "genres",
      "debug",
      "plex",
    ],
    permission: Permission.ADMIN,
  },
};

const TAB_ORDER: SettingsTab[] = [
  "general",
  "integrations",
  "recommendations",
  "purchaseDecision",
  "notifications",
  "logs",
  "tasteProfiles",
  "admin",
];

export function getVisibleTabs(userPermissions?: number): SettingsTab[] {
  const visibleSet = new Set<SettingsTab>();
  for (const meta of Object.values(SECTION_META)) {
    if (
      meta.permission === undefined ||
      (userPermissions !== undefined &&
        hasPermission(userPermissions, meta.permission))
    ) {
      visibleSet.add(meta.tab);
    }
  }

  return TAB_ORDER.filter((tab) => visibleSet.has(tab));
}

export function filterSections(
  query: string,
  userPermissions?: number
): SettingsSection[] {
  if (!query.trim()) return [];

  const lower = query.toLowerCase();
  return (Object.keys(SECTION_META) as SettingsSection[]).filter((section) => {
    const meta = SECTION_META[section];
    if (
      meta.permission !== undefined &&
      userPermissions !== undefined &&
      !hasPermission(userPermissions, meta.permission)
    ) {
      return false;
    }
    return (
      meta.label.toLowerCase().includes(lower) ||
      meta.keywords.some((kw) => kw.includes(lower))
    );
  });
}
