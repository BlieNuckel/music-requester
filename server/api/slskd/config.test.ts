import { describe, it, expect, vi, beforeEach } from "vitest";
import { getSlskdConfig } from "./config";
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

const fullConfig = {
  lidarrUrl: "",
  lidarrApiKey: "",
  lidarrQualityProfileId: 1,
  lidarrRootFolderPath: "",
  lidarrMetadataProfileId: 1,
  lastfmApiKey: "",
  plexUrl: "",
  importPath: "",
  slskdUrl: "http://slskd:5030",
  slskdApiKey: "slskd-api-key-123",
  slskdDownloadPath: "/downloads",
  torznabApiKey: "",
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

describe("getSlskdConfig", () => {
  it("returns config when slskd is configured", () => {
    mockGetConfig.mockReturnValue(fullConfig);

    const config = getSlskdConfig();
    expect(config.baseUrl).toBe("http://slskd:5030");
    expect(config.headers["X-API-Key"]).toBe("slskd-api-key-123");
    expect(config.headers["Content-Type"]).toBe("application/json");
    expect(config.headers["Accept"]).toBe("application/json");
    expect(config.downloadPath).toBe("/downloads");
  });

  it("throws when slskd is not configured", () => {
    mockGetConfig.mockReturnValue({
      ...fullConfig,
      slskdUrl: "",
      slskdApiKey: "",
    });

    expect(() => getSlskdConfig()).toThrow(
      "slskd URL and API key not configured"
    );
  });

  it("strips trailing slashes from URL", () => {
    mockGetConfig.mockReturnValue({
      ...fullConfig,
      slskdUrl: "http://slskd:5030///",
    });

    const config = getSlskdConfig();
    expect(config.baseUrl).toBe("http://slskd:5030");
  });
});
