import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPlexConfig } from "./config";
import {
  DEFAULT_PROMOTED_ALBUM,
  DEFAULT_PURCHASE_DECISION,
  DEFAULT_SPENDING,
  DEFAULT_NOTIFICATIONS,
  DEFAULT_LIVE_EVENTS,
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
  plexUrl: "http://plex:32400",
  importPath: "",
  slskdUrl: "",
  slskdApiKey: "",
  slskdDownloadPath: "",
  torznabApiKey: "",
  theme: "system" as const,
  promotedAlbum: DEFAULT_PROMOTED_ALBUM,
  purchaseDecision: DEFAULT_PURCHASE_DECISION,
  spending: DEFAULT_SPENDING,
  notifications: DEFAULT_NOTIFICATIONS,
  liveEvents: DEFAULT_LIVE_EVENTS,
  followedArtistPollIntervalMs: DEFAULT_FOLLOWED_POLL_INTERVAL_MS,
  requestStatusPollIntervalMs: DEFAULT_REQUEST_STATUS_POLL_INTERVAL_MS,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPlexConfig", () => {
  it("returns config when Plex URL is configured and token provided", () => {
    mockGetConfig.mockReturnValue(fullConfig);

    const config = getPlexConfig("plex-token-123");
    expect(config.baseUrl).toBe("http://plex:32400");
    expect(config.headers["X-Plex-Token"]).toBe("plex-token-123");
    expect(config.headers["Accept"]).toBe("application/json");
    expect(config.token).toBe("plex-token-123");
  });

  it("throws when Plex URL is not configured", () => {
    mockGetConfig.mockReturnValue({
      ...fullConfig,
      plexUrl: "",
    });

    expect(() => getPlexConfig("some-token")).toThrow(
      "Plex URL not configured"
    );
  });

  it("throws when no token is provided", () => {
    mockGetConfig.mockReturnValue(fullConfig);

    expect(() => getPlexConfig("")).toThrow("No Plex token available");
  });

  it("strips trailing slashes from URL", () => {
    mockGetConfig.mockReturnValue({
      ...fullConfig,
      plexUrl: "http://plex:32400///",
    });

    const config = getPlexConfig("plex-token-123");
    expect(config.baseUrl).toBe("http://plex:32400");
  });
});
