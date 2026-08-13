/**
 * The settings both sides of the wire need to agree on.
 *
 * The server deep-merges these under whatever is persisted, and the frontend spreads
 * them under whatever `/api/settings` returns. Two copies of that meant a new knob
 * added server-side and forgotten client-side would silently show the frontend's
 * guess in the settings form — and write that guess back as truth on the next save.
 * One definition, imported by both.
 */

export type LibraryPreference =
  "prefer_new" | "prefer_library" | "no_preference";

export type PromotedAlbumSettings = {
  cacheDurationMinutes: number;
  profileTtlMinutes: number;
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
  minAvailableTracksForDistribution: number;
};

export type PurchaseDecisionSettings = {
  labelBlocklist: string[];
  oldReleaseThresholdYears: number;
};

export type SpendingSettings = {
  currency: string;
  monthlyLimit: number | null;
};

export const DEFAULT_PROMOTED_ALBUM: PromotedAlbumSettings = {
  cacheDurationMinutes: 30,
  profileTtlMinutes: 1440,
  topArtistsCount: 10,
  pickedArtistsCount: 3,
  tagsPerArtist: 5,
  deepPageMin: 2,
  deepPageMax: 10,
  genericTags: [
    "seen live",
    "favorites",
    "favourite",
    "my favorite",
    "love",
    "awesome",
    "beautiful",
    "cool",
    "check out",
    "spotify",
    "under 2000 listeners",
    "all",
  ],
  libraryPreference: "prefer_new",
  explorationRate: 0.5,
  exploreCandidateCount: 12,
  genreOverlapThreshold: 0.15,
  backgroundRegenEnabled: true,
  backgroundRegenIntervalMinutes: 60,
  backgroundRegenActiveWithinMinutes: 10080,
  ratingsBackupEnabled: true,
  playTrendWindowDays: 90,
  ratingWeight: 0.5,
  distributionWeight: 0.5,
  minPlaysForDistribution: 5,
  minAvailableTracksForDistribution: 3,
};

export const DEFAULT_PURCHASE_DECISION: PurchaseDecisionSettings = {
  labelBlocklist: [],
  oldReleaseThresholdYears: 50,
};

export const DEFAULT_SPENDING: SpendingSettings = {
  currency: "USD",
  monthlyLimit: null,
};
