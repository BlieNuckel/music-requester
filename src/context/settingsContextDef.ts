import { createContext } from "react";
import type {
  PromotedAlbumSettings,
  PurchaseDecisionSettings,
  SpendingSettings,
} from "@shared/settingsDefaults";

export type {
  LibraryPreference,
  TopArtistsRange,
  PromotedAlbumSettings,
  PurchaseDecisionSettings,
  SpendingSettings,
} from "@shared/settingsDefaults";

export interface AppSettings {
  lidarrUrl: string;
  lidarrApiKey: string;
  lidarrQualityProfileId: number;
  lidarrRootFolderPath: string;
  lidarrMetadataProfileId: number;
  lastfmApiKey: string;
  plexUrl: string;
  importPath: string;
  slskdUrl: string;
  slskdApiKey: string;
  slskdDownloadPath: string;
  promotedAlbum?: PromotedAlbumSettings;
  purchaseDecision?: PurchaseDecisionSettings;
  spending?: SpendingSettings;
}

export type LidarrOptions = {
  qualityProfiles: { id: number; name: string }[];
  metadataProfiles: { id: number; name: string }[];
  rootFolderPaths: { id: number; path: string }[];
};

export interface SettingsContextValue {
  options: LidarrOptions;
  settings: AppSettings;
  isConnected: boolean;
  isLoading: boolean;
  saveSettings: (newSettings: AppSettings) => Promise<void>;
  savePartialSettings: (partial: Partial<AppSettings>) => Promise<void>;
  testConnection: (testSettings: AppSettings) => Promise<{
    success: boolean;
    version?: string;
    error?: string;
    qualityProfiles?: { id: number; name: string }[];
    metadataProfiles?: { id: number; name: string }[];
    rootFolderPaths?: { id: number; path: string }[];
  }>;
  testSlskdConnection: (testSettings: AppSettings) => Promise<{
    success: boolean;
    version?: string | null;
    soulseekConnected?: boolean;
    error?: string;
  }>;
  loadLidarrOptionValues: () => Promise<void>;
}

export const SettingsContext = createContext<SettingsContextValue | undefined>(
  undefined
);
