import { ReactNode, useState, useEffect, useCallback, useMemo } from "react";
import {
  SettingsContext,
  type AppSettings,
  type LidarrOptions,
  type SettingsContextValue,
} from "./settingsContextDef";
import { DEFAULT_PROMOTED_ALBUM } from "./promotedAlbumDefaults";
import { DEFAULT_PURCHASE_DECISION } from "./purchaseDecisionDefaults";
import { DEFAULT_SPENDING } from "./spendingDefaults";
import { DEFAULT_LIVE_EVENTS } from "@shared/settingsDefaults";
import { useAuth } from "./useAuth";
import { hasPermission, Permission } from "@shared/permissions";

interface SettingsContextProviderProps {
  children: ReactNode;
}

/**
 * Both loaders resolve to a settings updater rather than to settings, so the admin
 * and non-admin paths differ only in what they fetch, not in how the result is applied.
 */
type SettingsUpdate = (prev: AppSettings) => AppSettings;

type LoadResult =
  { ok: true; apply: SettingsUpdate } | { ok: false; message: string };

type FetchedOptions = {
  [K in keyof LidarrOptions]: LidarrOptions[K] | null;
};

const EMPTY_SETTINGS: AppSettings = {
  lidarrUrl: "",
  lidarrApiKey: "",
  lidarrQualityProfileId: 1,
  lidarrRootFolderPath: "",
  lidarrMetadataProfileId: 1,
  lastfmApiKey: "",
  plexUrl: "",
  importPath: "",
  slskdUrl: "",
  slskdApiKey: "",
  slskdDownloadPath: "",
  torznabApiKey: "",
  promotedAlbum: DEFAULT_PROMOTED_ALBUM,
  purchaseDecision: DEFAULT_PURCHASE_DECISION,
  spending: DEFAULT_SPENDING,
  liveEvents: DEFAULT_LIVE_EVENTS,
};

const EMPTY_OPTIONS: LidarrOptions = {
  qualityProfiles: [],
  metadataProfiles: [],
  rootFolderPaths: [],
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function normalizeSettings(data: Record<string, unknown>): AppSettings {
  return {
    lidarrUrl: (data.lidarrUrl as string) ?? "",
    lidarrApiKey: (data.lidarrApiKey as string) ?? "",
    lidarrQualityProfileId: (data.lidarrQualityProfileId as number) ?? 1,
    lidarrRootFolderPath: (data.lidarrRootFolderPath as string) ?? "",
    lidarrMetadataProfileId: (data.lidarrMetadataProfileId as number) ?? 1,
    lastfmApiKey: (data.lastfmApiKey as string) ?? "",
    plexUrl: (data.plexUrl as string) ?? "",
    importPath: (data.importPath as string) ?? "",
    slskdUrl: (data.slskdUrl as string) ?? "",
    slskdApiKey: (data.slskdApiKey as string) ?? "",
    slskdDownloadPath: (data.slskdDownloadPath as string) ?? "",
    torznabApiKey: (data.torznabApiKey as string) ?? "",
    promotedAlbum: {
      ...DEFAULT_PROMOTED_ALBUM,
      ...((data.promotedAlbum as object) ?? {}),
    },
    purchaseDecision: {
      ...DEFAULT_PURCHASE_DECISION,
      ...((data.purchaseDecision as object) ?? {}),
    },
    spending: {
      ...DEFAULT_SPENDING,
      ...((data.spending as object) ?? {}),
    },
    liveEvents: {
      ...DEFAULT_LIVE_EVENTS,
      ...((data.liveEvents as object) ?? {}),
    },
  };
}

/** Non-admins only learn whether Lidarr is configured; the settings themselves are admin-only. */
async function fetchConfigStatus(signal: AbortSignal): Promise<LoadResult> {
  try {
    const res = await fetch("/api/settings/status", { signal });
    if (!res.ok) {
      return { ok: false, message: `Settings status failed (${res.status})` };
    }
    const data = await res.json();
    return {
      ok: true,
      apply: (prev) =>
        data.configured ? { ...prev, lidarrUrl: "configured" } : prev,
    };
  } catch (error) {
    return {
      ok: false,
      message: errorMessage(error, "Settings status failed"),
    };
  }
}

async function fetchSettings(signal: AbortSignal): Promise<LoadResult> {
  try {
    const res = await fetch("/api/settings", { signal });
    if (!res.ok) {
      return { ok: false, message: `Failed to load settings (${res.status})` };
    }
    const loaded = normalizeSettings(await res.json());
    return { ok: true, apply: () => loaded };
  } catch (error) {
    return {
      ok: false,
      message: errorMessage(error, "Failed to load settings"),
    };
  }
}

async function readJsonArray(res: PromiseSettledResult<Response>) {
  if (res.status !== "fulfilled" || !res.value.ok) return null;
  try {
    return await res.value.json();
  } catch {
    return null;
  }
}

/**
 * The three option lists are independent, so they settle independently — one Lidarr
 * endpoint failing leaves the other two lists populated rather than blanking all three.
 * A `null` entry means "that fetch failed", which the caller reads as "keep what we had".
 */
async function fetchLidarrOptions(): Promise<FetchedOptions> {
  const [quality, metadata, root] = await Promise.allSettled([
    fetch("/api/lidarr/qualityprofiles"),
    fetch("/api/lidarr/metadataprofiles"),
    fetch("/api/lidarr/rootfolders"),
  ]);

  return {
    qualityProfiles: await readJsonArray(quality),
    metadataProfiles: await readJsonArray(metadata),
    rootFolderPaths: await readJsonArray(root),
  };
}

export const SettingsContextProvider = ({
  children,
}: SettingsContextProviderProps) => {
  const { status, user } = useAuth();

  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS);
  const [options, setOptions] = useState<LidarrOptions>(EMPTY_OPTIONS);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const isAuthenticated = status === "authenticated";
  const isAdmin =
    isAuthenticated &&
    user != null &&
    hasPermission(user.permissions, Permission.ADMIN);

  // `isAdmin` resolves after `isAuthenticated` (it needs `user`), so this effect
  // re-runs mid-load on a normal admin login. Without the abort, the earlier
  // status load could land last and overwrite the real settings with a stub.
  useEffect(() => {
    if (!isAuthenticated) return;

    const controller = new AbortController();

    const load = async () => {
      setIsLoading(true);
      const result = isAdmin
        ? await fetchSettings(controller.signal)
        : await fetchConfigStatus(controller.signal);

      if (controller.signal.aborted) return;

      if (result.ok) {
        setLoadError(null);
        setSettings(result.apply);
      } else {
        setLoadError(result.message);
      }
      setIsLoading(false);
    };

    void load();
    return () => controller.abort();
  }, [isAuthenticated, isAdmin]);

  const testConnection = useCallback(async (testSettings: AppSettings) => {
    const res = await fetch("/api/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testSettings),
    });

    const data = await res.json();

    if (!res.ok) {
      return { success: false, error: data.error || "Connection failed" };
    }

    return {
      success: true,
      version: data.version,
      qualityProfiles: data.qualityProfiles,
      metadataProfiles: data.metadataProfiles,
      rootFolderPaths: data.rootFolderPaths,
    };
  }, []);

  const testSlskdConnection = useCallback(async (testSettings: AppSettings) => {
    const res = await fetch("/api/settings/test-slskd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testSettings),
    });

    const data = await res.json();

    if (!res.ok) {
      return { success: false, error: data.error || "Connection failed" };
    }

    return {
      success: true,
      version: data.version,
      soulseekConnected: data.soulseekConnected,
    };
  }, []);

  const refreshLidarrOptions = useCallback(async () => {
    const fetched = await fetchLidarrOptions();
    setOptions((prev) => ({
      qualityProfiles: fetched.qualityProfiles ?? prev.qualityProfiles,
      metadataProfiles: fetched.metadataProfiles ?? prev.metadataProfiles,
      rootFolderPaths: fetched.rootFolderPaths ?? prev.rootFolderPaths,
    }));
  }, []);

  const savePartialSettings = useCallback(
    async (partial: Partial<AppSettings>) => {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save settings");
      }

      const merged = { ...settings, ...partial };
      setSettings(merged);

      const lidarrFieldsChanged =
        "lidarrUrl" in partial || "lidarrApiKey" in partial;

      if (lidarrFieldsChanged && merged.lidarrUrl && merged.lidarrApiKey) {
        const testResult = await testConnection(merged);
        setIsConnected(testResult.success);
        if (testResult.success) {
          await refreshLidarrOptions();
        }
      }
    },
    [settings, testConnection, refreshLidarrOptions]
  );

  const saveSettings = useCallback(
    async (newSettings: AppSettings) => {
      await savePartialSettings(newSettings);
    },
    [savePartialSettings]
  );

  const value: SettingsContextValue = useMemo(
    () => ({
      options,
      settings,
      isConnected,
      isLoading: isAuthenticated && isLoading,
      loadError,
      saveSettings,
      savePartialSettings,
      testConnection,
      testSlskdConnection,
      loadLidarrOptionValues: refreshLidarrOptions,
    }),
    [
      options,
      settings,
      isConnected,
      isAuthenticated,
      isLoading,
      loadError,
      saveSettings,
      savePartialSettings,
      testConnection,
      testSlskdConnection,
      refreshLidarrOptions,
    ]
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};
