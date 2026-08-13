import { createContext } from "react";

export type LibraryPreference =
  "prefer_new" | "prefer_library" | "no_preference";

export type TopArtistsRange = "all" | "4weeks" | "6months" | "12months";

export interface PromotedAlbumSettings {
  cacheDurationMinutes: number;
  profileTtlMinutes: number;
  topArtistsRange: TopArtistsRange;
  topArtistsCount: number;
  pickedArtistsCount: number;
  tagsPerArtist: number;
  deepPageMin: number;
  deepPageMax: number;
  genericTags: string[];
  libraryPreference: LibraryPreference;
  explorationRate: number;
  exploreCandidateCount: number;
  genreOverlapThreshold: number;
  backgroundRegenEnabled: boolean;
  backgroundRegenIntervalMinutes: number;
  backgroundRegenActiveWithinMinutes: number;
  ratingsBackupEnabled: boolean;
  playTrendWindowDays: number;
  ratingWeight: number;
  distributionWeight: number;
  minPlaysForDistribution: number;
}

export interface PurchaseDecisionSettings {
  labelBlocklist: string[];
  oldReleaseThresholdYears: number;
}

export interface SpendingSettings {
  currency: string;
  monthlyLimit: number | null;
}

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
  /** Why the last settings load failed, or null. Distinguishes a failed load from an unconfigured install. */
  loadError: string | null;
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
