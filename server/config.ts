import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getDataSource } from "./db/index";
import { createLogger } from "./logger";
import {
  DEFAULT_PROMOTED_ALBUM,
  DEFAULT_PURCHASE_DECISION,
  DEFAULT_SPENDING,
  DEFAULT_LIVE_EVENTS,
  type LibraryPreference,
  type PromotedAlbumSettings,
  type PurchaseDecisionSettings,
  type SpendingSettings,
  type LiveEventsSettings,
} from "../shared/settingsDefaults";

export {
  DEFAULT_PROMOTED_ALBUM,
  DEFAULT_PURCHASE_DECISION,
  DEFAULT_SPENDING,
  DEFAULT_LIVE_EVENTS,
} from "../shared/settingsDefaults";
export type { LibraryPreference } from "../shared/settingsDefaults";

/** Server-side aliases for the shared settings shapes. */
export type PromotedAlbumConfig = PromotedAlbumSettings;
export type PurchaseDecisionConfig = PurchaseDecisionSettings;
export type SpendingConfig = SpendingSettings;
export type LiveEventsConfig = LiveEventsSettings;

const log = createLogger("Config");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * VAPID identifies this server to the browser push services. The keypair is
 * generated on first boot and kept for the lifetime of the install: replacing it
 * invalidates every existing subscription.
 */
export type WebPushConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

/**
 * Master switch for the notification system. Individual transports add their own
 * sub-object here (`notifications.email`, `notifications.webhook`, …) as they land.
 */
export type NotificationsConfig = {
  enabled: boolean;
  webPush: WebPushConfig;
};

export type IConfig = {
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
  /** Shared secret Lidarr sends to `/api/torznab` and `/api/sabnzbd`. Empty disables the check. */
  torznabApiKey: string;
  promotedAlbum: PromotedAlbumConfig;
  purchaseDecision: PurchaseDecisionConfig;
  spending: SpendingConfig;
  notifications: NotificationsConfig;
  liveEvents: LiveEventsConfig;
  followedArtistPollIntervalMs: number;
  requestStatusPollIntervalMs: number;
};

/** Input type for setConfig — nested objects are optional since defaults are deep-merged */
export type IConfigInput = Omit<
  IConfig,
  | "promotedAlbum"
  | "purchaseDecision"
  | "spending"
  | "notifications"
  | "liveEvents"
> & {
  promotedAlbum?: Partial<PromotedAlbumConfig>;
  purchaseDecision?: Partial<PurchaseDecisionConfig>;
  spending?: Partial<SpendingConfig>;
  liveEvents?: Partial<LiveEventsConfig>;
  notifications?: Partial<Omit<NotificationsConfig, "webPush">> & {
    webPush?: Partial<WebPushConfig>;
  };
};

export const DEFAULT_WEB_PUSH: WebPushConfig = {
  publicKey: "",
  privateKey: "",
  subject: "https://github.com/BlieNuckel/tunearr",
};

export const DEFAULT_NOTIFICATIONS: NotificationsConfig = {
  enabled: true,
  webPush: DEFAULT_WEB_PUSH,
};

export const DEFAULT_FOLLOWED_POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_REQUEST_STATUS_POLL_INTERVAL_MS = 2 * 60 * 1000;

const DEFAULT_CONFIG: IConfig = {
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
  notifications: DEFAULT_NOTIFICATIONS,
  liveEvents: DEFAULT_LIVE_EVENTS,
  followedArtistPollIntervalMs: DEFAULT_FOLLOWED_POLL_INTERVAL_MS,
  requestStatusPollIntervalMs: DEFAULT_REQUEST_STATUS_POLL_INTERVAL_MS,
};

type RawStatement = {
  get(...params: unknown[]): Record<string, unknown> | undefined;
  run(...params: unknown[]): unknown;
};

type RawDatabase = {
  prepare(sql: string): RawStatement;
};

function getRawDb(): RawDatabase {
  const ds = getDataSource();
  return (ds.driver as unknown as { databaseConnection: RawDatabase })
    .databaseConnection;
}

function mergeWithDefaults(saved: Record<string, unknown>): IConfig {
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    promotedAlbum: {
      ...DEFAULT_PROMOTED_ALBUM,
      ...((saved.promotedAlbum as Record<string, unknown>) ?? {}),
    },
    purchaseDecision: {
      ...DEFAULT_PURCHASE_DECISION,
      ...((saved.purchaseDecision as Record<string, unknown>) ?? {}),
    },
    spending: {
      ...DEFAULT_SPENDING,
      ...((saved.spending as Record<string, unknown>) ?? {}),
    },
    liveEvents: {
      ...DEFAULT_LIVE_EVENTS,
      ...((saved.liveEvents as Record<string, unknown>) ?? {}),
    },
    notifications: {
      ...DEFAULT_NOTIFICATIONS,
      ...((saved.notifications as Record<string, unknown>) ?? {}),
      webPush: {
        ...DEFAULT_WEB_PUSH,
        ...(((saved.notifications as { webPush?: Record<string, unknown> })
          ?.webPush ?? {}) as Record<string, unknown>),
      },
    },
  } as IConfig;
}

export const getConfig = (): IConfig => {
  const db = getRawDb();
  const row = db.prepare("SELECT data FROM config WHERE id = 1").get() as
    { data: string } | undefined;

  if (!row) {
    return {
      ...DEFAULT_CONFIG,
      promotedAlbum: { ...DEFAULT_PROMOTED_ALBUM },
      purchaseDecision: { ...DEFAULT_PURCHASE_DECISION },
      spending: { ...DEFAULT_SPENDING },
      notifications: { ...DEFAULT_NOTIFICATIONS },
      liveEvents: { ...DEFAULT_LIVE_EVENTS },
    };
  }

  return mergeWithDefaults(JSON.parse(row.data));
};

const VALID_LIBRARY_PREFERENCES: LibraryPreference[] = [
  "prefer_new",
  "prefer_library",
  "no_preference",
];

function validatePositiveInt(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function validateNonNegativeInt(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function validateRatio(value: unknown, name: string) {
  if (typeof value !== "number" || value < 0 || value > 1) {
    throw new Error(`${name} must be a number between 0 and 1`);
  }
}

function validatePromotedAlbumConfig(config: PromotedAlbumConfig) {
  if (
    typeof config.cacheDurationMinutes !== "number" ||
    config.cacheDurationMinutes < 0
  ) {
    throw new Error("cacheDurationMinutes must be a non-negative number");
  }
  if (
    typeof config.profileTtlMinutes !== "number" ||
    config.profileTtlMinutes < 0
  ) {
    throw new Error("profileTtlMinutes must be a non-negative number");
  }
  validatePositiveInt(config.topArtistsCount, "topArtistsCount");
  validatePositiveInt(config.pickedArtistsCount, "pickedArtistsCount");
  validatePositiveInt(config.tagsPerArtist, "tagsPerArtist");
  validatePositiveInt(config.deepPageMin, "deepPageMin");
  validatePositiveInt(config.deepPageMax, "deepPageMax");
  if (config.deepPageMax < config.deepPageMin) {
    throw new Error("deepPageMax must be >= deepPageMin");
  }
  if (!Array.isArray(config.genericTags)) {
    throw new Error("genericTags must be an array");
  }
  validateRatio(config.explorationRate, "explorationRate");
  validatePositiveInt(config.exploreCandidateCount, "exploreCandidateCount");
  validateRatio(config.genreOverlapThreshold, "genreOverlapThreshold");
  if (typeof config.backgroundRegenEnabled !== "boolean") {
    throw new Error("backgroundRegenEnabled must be a boolean");
  }
  validatePositiveInt(
    config.backgroundRegenIntervalMinutes,
    "backgroundRegenIntervalMinutes"
  );
  validatePositiveInt(
    config.backgroundRegenActiveWithinMinutes,
    "backgroundRegenActiveWithinMinutes"
  );
  if (typeof config.ratingsBackupEnabled !== "boolean") {
    throw new Error("ratingsBackupEnabled must be a boolean");
  }
  validatePositiveInt(config.playTrendWindowDays, "playTrendWindowDays");
  if (
    typeof config.distributionWeight !== "number" ||
    config.distributionWeight < 0 ||
    config.distributionWeight > 1
  ) {
    throw new Error("distributionWeight must be a number between 0 and 1");
  }
  validatePositiveInt(
    config.minPlaysForDistribution,
    "minPlaysForDistribution"
  );
  validateNonNegativeInt(
    config.minAvailableTracksForDistribution,
    "minAvailableTracksForDistribution"
  );
  if (typeof config.ratingWeight !== "number" || config.ratingWeight < 0) {
    throw new Error("ratingWeight must be a non-negative number");
  }
  if (
    !VALID_LIBRARY_PREFERENCES.includes(
      config.libraryPreference as LibraryPreference
    )
  ) {
    throw new Error(
      `libraryPreference must be one of: ${VALID_LIBRARY_PREFERENCES.join(", ")}`
    );
  }
}

function validatePurchaseDecisionConfig(config: PurchaseDecisionConfig) {
  if (!Array.isArray(config.labelBlocklist)) {
    throw new Error("labelBlocklist must be an array");
  }
  if (
    !config.labelBlocklist.every(
      (e) => typeof e === "string" && e.trim().length > 0
    )
  ) {
    throw new Error("labelBlocklist entries must be non-empty strings");
  }
  if (
    typeof config.oldReleaseThresholdYears !== "number" ||
    config.oldReleaseThresholdYears < 0
  ) {
    throw new Error("oldReleaseThresholdYears must be a non-negative number");
  }
}

function validateSpendingConfig(config: SpendingConfig) {
  if (typeof config.currency !== "string" || config.currency.length !== 3) {
    throw new Error("currency must be a 3-letter ISO 4217 code");
  }
  if (
    config.monthlyLimit !== null &&
    (typeof config.monthlyLimit !== "number" ||
      !Number.isInteger(config.monthlyLimit) ||
      config.monthlyLimit < 0)
  ) {
    throw new Error("monthlyLimit must be a non-negative integer or null");
  }
}

function validateNotificationsConfig(config: NotificationsConfig) {
  if (typeof config.enabled !== "boolean") {
    throw new Error("notifications.enabled must be a boolean");
  }
  const webPush = config.webPush;
  if (
    typeof webPush.publicKey !== "string" ||
    typeof webPush.privateKey !== "string"
  ) {
    throw new Error("notifications.webPush keys must be strings");
  }
  if (
    typeof webPush.subject !== "string" ||
    !/^(mailto:|https:\/\/)/.test(webPush.subject)
  ) {
    throw new Error(
      "notifications.webPush.subject must be a mailto: or https:// URL"
    );
  }
}

const ISO2 = /^[A-Z]{2}$/;

/** The Developer tier only returns events up to six months out. */
const MAX_BANNER_HORIZON_DAYS = 180;

function validateLiveEventsConfig(config: LiveEventsConfig) {
  if (typeof config.enabled !== "boolean") {
    throw new Error("liveEvents.enabled must be a boolean");
  }
  if (typeof config.apiKey !== "string") {
    throw new Error("liveEvents.apiKey must be a string");
  }

  for (const [name, value] of [
    ["originLat", config.originLat],
    ["originLon", config.originLon],
  ] as const) {
    if (value !== null && typeof value !== "number") {
      throw new Error(`liveEvents.${name} must be a number or null`);
    }
  }
  if (config.originLat !== null && Math.abs(config.originLat) > 90) {
    throw new Error("liveEvents.originLat must be between -90 and 90");
  }
  if (config.originLon !== null && Math.abs(config.originLon) > 180) {
    throw new Error("liveEvents.originLon must be between -180 and 180");
  }

  validatePositiveInt(config.sweepRadiusKm, "liveEvents.sweepRadiusKm");
  validatePositiveInt(config.shelfHorizonDays, "liveEvents.shelfHorizonDays");
  validatePositiveInt(config.bannerHorizonDays, "liveEvents.bannerHorizonDays");
  validatePositiveInt(config.announceDays, "liveEvents.announceDays");
  validatePositiveInt(config.imminentDaysLocal, "liveEvents.imminentDaysLocal");
  validatePositiveInt(
    config.imminentDaysRegional,
    "liveEvents.imminentDaysRegional"
  );
  validatePositiveInt(config.rosterBatchSize, "liveEvents.rosterBatchSize");
  validatePositiveInt(config.maxPagesPerRun, "liveEvents.maxPagesPerRun");
  validatePositiveInt(
    config.sweepIntervalHours,
    "liveEvents.sweepIntervalHours"
  );
  validatePositiveInt(
    config.fullSweepIntervalDays,
    "liveEvents.fullSweepIntervalDays"
  );
  validatePositiveInt(config.monthlyQuota, "liveEvents.monthlyQuota");
  validateRatio(config.quotaWarnRatio, "liveEvents.quotaWarnRatio");
  validatePositiveInt(
    config.billingPeriodStartDay,
    "liveEvents.billingPeriodStartDay"
  );
  if (config.billingPeriodStartDay > 28) {
    throw new Error(
      "liveEvents.billingPeriodStartDay must be 28 or lower so every month has one"
    );
  }
  if (typeof config.quotaHardStop !== "boolean") {
    throw new Error("liveEvents.quotaHardStop must be a boolean");
  }

  for (const [name, value] of [
    ["rosterWatermark", config.rosterWatermark],
    ["rosterFullSweptAt", config.rosterFullSweptAt],
  ] as const) {
    if (value !== null && typeof value !== "string") {
      throw new Error(`liveEvents.${name} must be a string or null`);
    }
  }
  validateRatio(config.shelfMinAffinity, "liveEvents.shelfMinAffinity");

  if (config.bannerHorizonDays > MAX_BANNER_HORIZON_DAYS) {
    throw new Error(
      `liveEvents.bannerHorizonDays cannot exceed ${MAX_BANNER_HORIZON_DAYS}; the Developer tier returns nothing further out`
    );
  }
  if (config.rosterBatchSize > 100) {
    throw new Error("liveEvents.rosterBatchSize cannot exceed 100");
  }
  if (!Array.isArray(config.regions)) {
    throw new Error("liveEvents.regions must be an array");
  }
  for (const code of config.regions) {
    if (typeof code !== "string" || !ISO2.test(code)) {
      throw new Error(
        `liveEvents.regions entries must be uppercase ISO 3166-1 alpha-2 codes; got ${String(code)}`
      );
    }
    if (code === "UK") {
      throw new Error("liveEvents.regions must use GB rather than UK");
    }
  }
}

function validateConfig(mergedConfig: IConfig) {
  if (typeof mergedConfig.lidarrUrl !== "string") {
    throw new Error("lidarrUrl must be a string");
  }
  if (typeof mergedConfig.lidarrApiKey !== "string") {
    throw new Error("lidarrApiKey must be a string");
  }
  if (typeof mergedConfig.lidarrQualityProfileId !== "number") {
    throw new Error("lidarrQualityProfileId must be a number");
  }
  if (typeof mergedConfig.lidarrRootFolderPath !== "string") {
    throw new Error("lidarrRootFolderPath must be a string");
  }
  if (typeof mergedConfig.lidarrMetadataProfileId !== "number") {
    throw new Error("lidarrMetadataProfileId must be a number");
  }
  if (typeof mergedConfig.lastfmApiKey !== "string") {
    throw new Error("lastfmApiKey must be a string");
  }
  if (typeof mergedConfig.plexUrl !== "string") {
    throw new Error("plexUrl must be a string");
  }
  if (typeof mergedConfig.importPath !== "string") {
    throw new Error("importPath must be a string");
  }
  if (typeof mergedConfig.slskdUrl !== "string") {
    throw new Error("slskdUrl must be a string");
  }
  if (typeof mergedConfig.slskdApiKey !== "string") {
    throw new Error("slskdApiKey must be a string");
  }
  if (typeof mergedConfig.slskdDownloadPath !== "string") {
    throw new Error("slskdDownloadPath must be a string");
  }
  if (typeof mergedConfig.torznabApiKey !== "string") {
    throw new Error("torznabApiKey must be a string");
  }
  if (
    typeof mergedConfig.followedArtistPollIntervalMs !== "number" ||
    mergedConfig.followedArtistPollIntervalMs < 60_000
  ) {
    throw new Error(
      "followedArtistPollIntervalMs must be a number >= 60000 (1 minute)"
    );
  }
  if (
    typeof mergedConfig.requestStatusPollIntervalMs !== "number" ||
    mergedConfig.requestStatusPollIntervalMs < 60_000
  ) {
    throw new Error(
      "requestStatusPollIntervalMs must be a number >= 60000 (1 minute)"
    );
  }
}

export const setConfig = (newConfig: Partial<IConfigInput>) => {
  const currentConfig = getConfig();
  const mergedConfig = {
    ...currentConfig,
    ...newConfig,
    promotedAlbum: {
      ...currentConfig.promotedAlbum,
      ...(newConfig.promotedAlbum ?? {}),
    },
    purchaseDecision: {
      ...currentConfig.purchaseDecision,
      ...(newConfig.purchaseDecision ?? {}),
    },
    spending: {
      ...currentConfig.spending,
      ...(newConfig.spending ?? {}),
    },
    notifications: {
      ...currentConfig.notifications,
      ...(newConfig.notifications ?? {}),
      webPush: {
        ...currentConfig.notifications.webPush,
        ...(newConfig.notifications?.webPush ?? {}),
      },
    },
    liveEvents: {
      ...currentConfig.liveEvents,
      ...(newConfig.liveEvents ?? {}),
    },
  };

  validateConfig(mergedConfig);

  if (newConfig.promotedAlbum !== undefined) {
    validatePromotedAlbumConfig(mergedConfig.promotedAlbum);
  }

  if (newConfig.purchaseDecision !== undefined) {
    validatePurchaseDecisionConfig(mergedConfig.purchaseDecision);
  }

  if (newConfig.spending !== undefined) {
    validateSpendingConfig(mergedConfig.spending);
  }

  if (newConfig.notifications !== undefined) {
    validateNotificationsConfig(mergedConfig.notifications);
  }

  if (newConfig.liveEvents !== undefined) {
    validateLiveEventsConfig(mergedConfig.liveEvents);
  }

  const db = getRawDb();
  db.prepare("UPDATE config SET data = ? WHERE id = 1").run(
    JSON.stringify(mergedConfig)
  );
};

export const getConfigValue = <K extends keyof IConfig>(key: K): IConfig[K] => {
  return getConfig()[key];
};

function getConfigJsonPath(): string {
  const configDir =
    process.env.APP_CONFIG_DIR || path.join(__dirname, "..", "config");
  return path.join(configDir, "config.json");
}

export const initializeConfig = () => {
  const db = getRawDb();
  const row = db.prepare("SELECT data FROM config WHERE id = 1").get();

  if (row) {
    return;
  }

  let initialConfig: IConfig = {
    ...DEFAULT_CONFIG,
    promotedAlbum: { ...DEFAULT_PROMOTED_ALBUM },
    purchaseDecision: { ...DEFAULT_PURCHASE_DECISION },
    spending: { ...DEFAULT_SPENDING },
    notifications: { ...DEFAULT_NOTIFICATIONS },
  };

  const configJsonPath = getConfigJsonPath();
  if (fs.existsSync(configJsonPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(configJsonPath, "utf-8"));
      initialConfig = mergeWithDefaults(saved);
      fs.renameSync(configJsonPath, configJsonPath + ".migrated");
      log.info("Migrated config from config.json to database");
    } catch {
      log.warn("Failed to read config.json, using defaults");
    }
  }

  db.prepare("INSERT INTO config (id, data) VALUES (1, ?)").run(
    JSON.stringify(initialConfig)
  );
};
