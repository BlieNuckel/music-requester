import { describe, it, expect, vi, beforeEach } from "vitest";
import { getLidarrConfig } from "./config";
import {
  DEFAULT_PROMOTED_ALBUM,
  DEFAULT_PURCHASE_DECISION,
  DEFAULT_SPENDING,
  DEFAULT_NOTIFICATIONS,
  DEFAULT_FOLLOWED_POLL_INTERVAL_MS,
  DEFAULT_REQUEST_STATUS_POLL_INTERVAL_MS,
} from "../../config";

vi.mock("../../config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config")>();
  return { ...actual, getConfig: vi.fn() };
});

import { getConfig } from "../../config";

const mockGetConfig = vi.mocked(getConfig);

const baseConfig = {
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
  theme: "system" as const,
  promotedAlbum: DEFAULT_PROMOTED_ALBUM,
  purchaseDecision: DEFAULT_PURCHASE_DECISION,
  spending: DEFAULT_SPENDING,
  notifications: DEFAULT_NOTIFICATIONS,
  followedArtistPollIntervalMs: DEFAULT_FOLLOWED_POLL_INTERVAL_MS,
  requestStatusPollIntervalMs: DEFAULT_REQUEST_STATUS_POLL_INTERVAL_MS,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getLidarrConfig", () => {
  it("returns url and headers when configured", () => {
    mockGetConfig.mockReturnValue({
      ...baseConfig,
      lidarrUrl: "http://lidarr:8686",
      lidarrApiKey: "test-api-key",
      lidarrRootFolderPath: "/music",
    });

    const config = getLidarrConfig();
    expect(config.url).toBe("http://lidarr:8686");
    expect(config.headers["X-Api-Key"]).toBe("test-api-key");
    expect(config.headers["Content-Type"]).toBe("application/json");
  });

  it("throws when lidarr is not configured", () => {
    mockGetConfig.mockReturnValue(baseConfig);

    expect(() => getLidarrConfig()).toThrow("Lidarr not configured");
  });

  it("throws when only url is set but not api key", () => {
    mockGetConfig.mockReturnValue({
      ...baseConfig,
      lidarrUrl: "http://lidarr:8686",
    });

    expect(() => getLidarrConfig()).toThrow("Lidarr not configured");
  });
});
