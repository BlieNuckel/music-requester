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
  /**
   * Where an artist's weight comes from: `0` ranks on play counts, `1` on listening time.
   * Plays count decisions to hear something again, time counts exposure, and the two
   * disagree most on very long tracks.
   */
  listeningWeight: number;
  /**
   * Ceiling on what one play of a single track is worth, in minutes. `0` is uncapped and is
   * the default; it exists only to blunt the seek-past-halfway path, which commits a play
   * for listening that never happened.
   */
  maxTrackMinutesForWeight: number;
  /** Width of one bucket in the per-artist listening series, in days. */
  seriesBucketDays: number;
  /** How far back that series runs, in days. */
  seriesSpanDays: number;
  /**
   * How many trailing buckets count as "recent" when measuring momentum. An artist's
   * recent average is compared against its own earlier buckets, so this is the only knob
   * deciding whether a two-week surge reads as momentum or as noise.
   */
  momentumRecentBuckets: number;
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
  listeningWeight: 1,
  maxTrackMinutesForWeight: 0,
  seriesBucketDays: 7,
  seriesSpanDays: 182,
  momentumRecentBuckets: 4,
};

export const DEFAULT_PURCHASE_DECISION: PurchaseDecisionSettings = {
  labelBlocklist: [],
  oldReleaseThresholdYears: 50,
};

export const DEFAULT_SPENDING: SpendingSettings = {
  currency: "USD",
  monthlyLimit: null,
};

/**
 * Live events (tour dates). Everything here spends or bounds JamBase quota,
 * which is why it is server-wide: per-user knobs are filters over already-swept
 * data and live on the user row instead.
 */
export type LiveEventsSettings = {
  enabled: boolean;
  apiKey: string;
  /** Origin for the shelf sweep. Null until an admin sets a location. */
  originLat: number | null;
  originLon: number | null;
  /** Maximum swept radius, not the per-user display radius. */
  sweepRadiusKm: number;
  shelfHorizonDays: number;
  shelfMinAffinity: number;
  /** Capped at 180 by the Developer tier's 6-month future window. */
  bannerHorizonDays: number;
  announceDays: number;
  /** The imminent window scales with distance: a trip needs more lead time. */
  imminentDaysLocal: number;
  imminentDaysRegional: number;
  /** ISO 3166-1 alpha-2 default for users who have not chosen their own. GB, not UK. */
  regions: string[];
  /** JamBase accepts at least 100 pipe-delimited artistIds per call. */
  rosterBatchSize: number;
  /** Hard stop per run. Overage bills rather than fails, so this is a cost control. */
  maxPagesPerRun: number;
  sweepIntervalHours: number;
  /** How often a non-delta pass runs to catch anything a delta sweep missed. */
  fullSweepIntervalDays: number;
  /**
   * Delta state, not a preference: the watermark a `dateModifiedFrom` sweep
   * resumes from, and when the last full pass completed. Null means the next run
   * is a full pass.
   */
  rosterWatermark: string | null;
  rosterFullSweptAt: string | null;
  /** Plan allowance. Editable because paid tiers differ (Startup is 20,000). */
  monthlyQuota: number;
  quotaWarnRatio: number;
  /** The API bills past the allowance rather than refusing, so we stop instead. */
  quotaHardStop: boolean;
  /** Billing periods start on the subscription date, not the 1st. */
  billingPeriodStartDay: number;
};

export const DEFAULT_LIVE_EVENTS: LiveEventsSettings = {
  enabled: false,
  apiKey: "",
  originLat: null,
  originLon: null,
  sweepRadiusKm: 150,
  shelfHorizonDays: 28,
  shelfMinAffinity: 0,
  bannerHorizonDays: 180,
  announceDays: 14,
  imminentDaysLocal: 21,
  imminentDaysRegional: 45,
  regions: [],
  rosterBatchSize: 100,
  maxPagesPerRun: 20,
  sweepIntervalHours: 24,
  fullSweepIntervalDays: 30,
  rosterWatermark: null,
  rosterFullSweptAt: null,
  monthlyQuota: 1000,
  quotaWarnRatio: 0.8,
  quotaHardStop: true,
  billingPeriodStartDay: 1,
};
