import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { initializeDatabase, closeDatabase } from "./db/index";
import {
  DEFAULT_PROMOTED_ALBUM as SHARED_PROMOTED_ALBUM,
  DEFAULT_PURCHASE_DECISION as SHARED_PURCHASE_DECISION,
  DEFAULT_SPENDING as SHARED_SPENDING,
} from "../shared/settingsDefaults";
import {
  getConfig,
  setConfig,
  getConfigValue,
  initializeConfig,
  DEFAULT_PROMOTED_ALBUM,
  DEFAULT_NOTIFICATIONS,
} from "./config";

let tmpDir: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
  fs.mkdirSync(path.join(tmpDir, "logs"), { recursive: true });
  originalEnv = process.env.APP_CONFIG_DIR;
  process.env.APP_CONFIG_DIR = tmpDir;
  await initializeDatabase(path.join(tmpDir, "test.db"));
});

afterEach(async () => {
  await closeDatabase();
  process.env.APP_CONFIG_DIR = originalEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("initializeConfig", () => {
  it("seeds defaults when no config.json exists", () => {
    initializeConfig();
    const config = getConfig();

    expect(config.lidarrUrl).toBe("");
    expect(config.lidarrApiKey).toBe("");
    expect(config.promotedAlbum).toEqual(DEFAULT_PROMOTED_ALBUM);
  });

  it("migrates data from config.json on first run", () => {
    fs.writeFileSync(
      path.join(tmpDir, "config.json"),
      JSON.stringify({
        lidarrUrl: "http://lidarr:8686",
        lidarrApiKey: "abc",
      })
    );

    initializeConfig();
    const config = getConfig();

    expect(config.lidarrUrl).toBe("http://lidarr:8686");
    expect(config.lidarrApiKey).toBe("abc");
    expect(config.lidarrQualityProfileId).toBe(1);
  });

  it("renames config.json to config.json.migrated after migration", () => {
    fs.writeFileSync(
      path.join(tmpDir, "config.json"),
      JSON.stringify({ lidarrUrl: "http://test:8686" })
    );

    initializeConfig();

    expect(fs.existsSync(path.join(tmpDir, "config.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "config.json.migrated"))).toBe(true);
  });

  it("does not overwrite existing DB config on subsequent calls", () => {
    initializeConfig();
    setConfig({ lidarrUrl: "http://updated:8686" });

    initializeConfig();
    const config = getConfig();
    expect(config.lidarrUrl).toBe("http://updated:8686");
  });

  it("deep merges promotedAlbum from config.json", () => {
    fs.writeFileSync(
      path.join(tmpDir, "config.json"),
      JSON.stringify({
        promotedAlbum: { topArtistsCount: 20, cacheDurationMinutes: 60 },
      })
    );

    initializeConfig();
    const config = getConfig();

    expect(config.promotedAlbum.topArtistsCount).toBe(20);
    expect(config.promotedAlbum.cacheDurationMinutes).toBe(60);
    expect(config.promotedAlbum.pickedArtistsCount).toBe(
      DEFAULT_PROMOTED_ALBUM.pickedArtistsCount
    );
  });
});

describe("getConfig", () => {
  it("returns defaults when DB row exists with empty data", () => {
    initializeConfig();
    const config = getConfig();

    expect(config.lidarrUrl).toBe("");
    expect(config.lidarrApiKey).toBe("");
    expect(config.lidarrQualityProfileId).toBe(1);
    expect(config.lidarrRootFolderPath).toBe("");
    expect(config.lidarrMetadataProfileId).toBe(1);
    expect(config.lastfmApiKey).toBe("");
    expect(config.plexUrl).toBe("");
    expect(config.importPath).toBe("");
    expect(config.slskdUrl).toBe("");
    expect(config.slskdApiKey).toBe("");
    expect(config.slskdDownloadPath).toBe("");
  });

  it("reads saved config and merges with defaults", () => {
    initializeConfig();
    setConfig({ lidarrUrl: "http://lidarr:8686", lidarrApiKey: "abc" });

    const config = getConfig();
    expect(config.lidarrUrl).toBe("http://lidarr:8686");
    expect(config.lidarrApiKey).toBe("abc");
    expect(config.lidarrQualityProfileId).toBe(1);
  });
});

describe("setConfig", () => {
  beforeEach(() => {
    initializeConfig();
  });

  it("writes config and merges with existing", () => {
    const base = {
      lidarrUrl: "http://test:8686",
      lidarrApiKey: "key1",
      lidarrQualityProfileId: 1,
      lidarrRootFolderPath: "/music",
      lidarrMetadataProfileId: 1,
    };

    setConfig(base);
    let config = getConfig();
    expect(config.lidarrUrl).toBe("http://test:8686");
    expect(config.lidarrApiKey).toBe("key1");

    setConfig({ ...base, lidarrUrl: "http://updated:8686" });
    config = getConfig();
    expect(config.lidarrUrl).toBe("http://updated:8686");
  });

  it("validates types", () => {
    expect(() => setConfig({ lidarrUrl: 123 as unknown as string })).toThrow(
      "lidarrUrl must be a string"
    );

    expect(() =>
      setConfig({
        lidarrUrl: "",
        lidarrApiKey: "",
        lidarrQualityProfileId: "bad" as unknown as number,
      })
    ).toThrow("lidarrQualityProfileId must be a number");
  });
});

describe("getConfigValue", () => {
  it("returns specific config value", () => {
    initializeConfig();
    setConfig({ lastfmApiKey: "fm-key-123" });

    expect(getConfigValue("lastfmApiKey")).toBe("fm-key-123");
    expect(getConfigValue("lidarrQualityProfileId")).toBe(1);
  });
});

describe("promotedAlbum config", () => {
  beforeEach(() => {
    initializeConfig();
  });

  it("returns full defaults when no promotedAlbum has been set", () => {
    const config = getConfig();
    expect(config.promotedAlbum).toEqual(DEFAULT_PROMOTED_ALBUM);
  });

  it("deep merges promotedAlbum on setConfig", () => {
    setConfig({ promotedAlbum: { topArtistsCount: 25 } as never });
    const config = getConfig();

    expect(config.promotedAlbum.topArtistsCount).toBe(25);
    expect(config.promotedAlbum.pickedArtistsCount).toBe(3);
  });

  it("validates positive integers", () => {
    expect(() =>
      setConfig({ promotedAlbum: { topArtistsCount: 0 } as never })
    ).toThrow("topArtistsCount must be a positive integer");

    expect(() =>
      setConfig({ promotedAlbum: { pickedArtistsCount: -1 } as never })
    ).toThrow("pickedArtistsCount must be a positive integer");
  });

  it("validates deepPageMax >= deepPageMin", () => {
    expect(() =>
      setConfig({
        promotedAlbum: { deepPageMin: 5, deepPageMax: 3 } as never,
      })
    ).toThrow("deepPageMax must be >= deepPageMin");
  });

  it("validates cacheDurationMinutes is non-negative", () => {
    expect(() =>
      setConfig({ promotedAlbum: { cacheDurationMinutes: -1 } as never })
    ).toThrow("cacheDurationMinutes must be a non-negative number");
  });

  it("validates profileTtlMinutes is non-negative", () => {
    expect(() =>
      setConfig({ promotedAlbum: { profileTtlMinutes: -1 } as never })
    ).toThrow("profileTtlMinutes must be a non-negative number");
  });

  it("validates libraryPreference enum", () => {
    expect(() =>
      setConfig({ promotedAlbum: { libraryPreference: "invalid" } as never })
    ).toThrow("libraryPreference must be one of");
  });

  it("validates genericTags is an array", () => {
    expect(() =>
      setConfig({ promotedAlbum: { genericTags: "not-array" } as never })
    ).toThrow("genericTags must be an array");
  });

  it("validates ratingsBackupEnabled is a boolean", () => {
    expect(() =>
      setConfig({ promotedAlbum: { ratingsBackupEnabled: "yes" } as never })
    ).toThrow("ratingsBackupEnabled must be a boolean");
  });

  it("validates playTrendWindowDays is a positive integer", () => {
    expect(() =>
      setConfig({ promotedAlbum: { playTrendWindowDays: 0 } as never })
    ).toThrow("playTrendWindowDays must be a positive integer");
  });

  it("validates ratingWeight is non-negative", () => {
    expect(() =>
      setConfig({ promotedAlbum: { ratingWeight: -1 } as never })
    ).toThrow("ratingWeight must be a non-negative number");
  });

  it("validates distributionWeight stays within 0–1", () => {
    expect(() =>
      setConfig({ promotedAlbum: { distributionWeight: 1.5 } as never })
    ).toThrow("distributionWeight must be a number between 0 and 1");
    expect(() =>
      setConfig({ promotedAlbum: { distributionWeight: -0.1 } as never })
    ).toThrow("distributionWeight must be a number between 0 and 1");
  });

  it("validates minPlaysForDistribution is a positive integer", () => {
    expect(() =>
      setConfig({ promotedAlbum: { minPlaysForDistribution: 0 } as never })
    ).toThrow("minPlaysForDistribution must be a positive integer");
  });

  it("allows valid promotedAlbum config", () => {
    setConfig({
      promotedAlbum: {
        cacheDurationMinutes: 0,
        topArtistsCount: 5,
        pickedArtistsCount: 2,
        tagsPerArtist: 3,
        deepPageMin: 1,
        deepPageMax: 5,
        genericTags: ["rock"],
        libraryPreference: "prefer_library",
      },
    });

    const config = getConfig();
    expect(config.promotedAlbum.cacheDurationMinutes).toBe(0);
    expect(config.promotedAlbum.libraryPreference).toBe("prefer_library");
  });
});

describe("notifications config", () => {
  beforeEach(() => {
    initializeConfig();
  });

  it("returns defaults when nothing has been set", () => {
    expect(getConfig().notifications).toEqual(DEFAULT_NOTIFICATIONS);
  });

  it("deep merges notifications on setConfig", () => {
    setConfig({ notifications: { enabled: false } });

    expect(getConfig().notifications.enabled).toBe(false);
  });

  it("validates the enabled flag", () => {
    expect(() =>
      setConfig({ notifications: { enabled: "yes" } as never })
    ).toThrow("notifications.enabled must be a boolean");
  });
});

describe("web push config", () => {
  beforeEach(() => {
    initializeConfig();
  });

  it("starts with no keypair and a valid default subject", () => {
    const { webPush } = getConfig().notifications;

    expect(webPush.publicKey).toBe("");
    expect(webPush.privateKey).toBe("");
    expect(webPush.subject.startsWith("https://")).toBe(true);
  });

  it("deep merges webPush without clearing the other notification fields", () => {
    setConfig({ notifications: { webPush: { publicKey: "pub" } } });
    const { notifications } = getConfig();

    expect(notifications.webPush.publicKey).toBe("pub");
    expect(notifications.webPush.subject).toBe(
      DEFAULT_NOTIFICATIONS.webPush.subject
    );
    expect(notifications.enabled).toBe(true);
  });

  it("rejects a subject that is not mailto: or https://", () => {
    expect(() =>
      setConfig({ notifications: { webPush: { subject: "tunearr" } } })
    ).toThrow(
      "notifications.webPush.subject must be a mailto: or https:// URL"
    );
  });

  it("accepts a mailto: subject", () => {
    setConfig({
      notifications: { webPush: { subject: "mailto:admin@example.com" } },
    });

    expect(getConfig().notifications.webPush.subject).toBe(
      "mailto:admin@example.com"
    );
  });
});

describe("shared settings defaults", () => {
  beforeEach(() => {
    initializeConfig();
  });

  it("seeds every shared default section verbatim", () => {
    const config = getConfig();

    expect(config.promotedAlbum).toEqual(SHARED_PROMOTED_ALBUM);
    expect(config.purchaseDecision).toEqual(SHARED_PURCHASE_DECISION);
    expect(config.spending).toEqual(SHARED_SPENDING);
  });

  it("treats a null nested section as 'no change' rather than wiping it", () => {
    setConfig({ promotedAlbum: { topArtistsCount: 25 } as never });
    setConfig({ promotedAlbum: null as never });

    expect(getConfig().promotedAlbum.topArtistsCount).toBe(25);
  });

  it("still validates a nested section supplied as null-valued keys", () => {
    expect(() =>
      setConfig({ promotedAlbum: { topArtistsCount: null } as never })
    ).toThrow("topArtistsCount must be a positive integer");
  });

  it("does not let a partial nested write drop the other keys", () => {
    setConfig({ spending: { monthlyLimit: 25 } as never });

    const { spending } = getConfig();
    expect(spending.monthlyLimit).toBe(25);
    expect(spending.currency).toBe(SHARED_SPENDING.currency);
  });
});
