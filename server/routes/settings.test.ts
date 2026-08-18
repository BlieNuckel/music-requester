import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetConfig = vi.fn();
const mockSetConfig = vi.fn();
const mockValidateWritableDirectory = vi.fn();
const mockListDirectorySuggestions = vi.fn();
const mockClearPromotedAlbumCache = vi.fn();
const mockTestLidarrConnection = vi.fn();
const mockTestSlskdConnection = vi.fn();
const mockSnapshotLiveEvents = vi.fn();
const mockOnLiveEventsSaved = vi.fn();

vi.mock("../config", () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  setConfig: (...args: unknown[]) => mockSetConfig(...args),
}));

vi.mock("../services/pathValidation", () => ({
  validateWritableDirectory: (...args: unknown[]) =>
    mockValidateWritableDirectory(...args),
  listDirectorySuggestions: (...args: unknown[]) =>
    mockListDirectorySuggestions(...args),
}));

vi.mock("../promotedAlbum/getPromotedAlbum", () => ({
  clearPromotedAlbumCache: (...args: unknown[]) =>
    mockClearPromotedAlbumCache(...args),
}));

vi.mock("../services/settings", () => ({
  testLidarrConnection: (...args: unknown[]) =>
    mockTestLidarrConnection(...args),
}));

vi.mock("../services/liveEvents/settingsChange", () => ({
  snapshotLiveEventsSettings: () => mockSnapshotLiveEvents(),
  onLiveEventsSettingsSaved: (...args: unknown[]) =>
    mockOnLiveEventsSaved(...args),
}));

vi.mock("../api/slskd/testConnection", () => ({
  testSlskdConnection: (...args: unknown[]) => mockTestSlskdConnection(...args),
}));

vi.mock("../middleware/requireAuth", () => ({
  requireAuth: (
    req: {
      user: {
        id: number;
        username: string;
        permissions: number;
        enabled: boolean;
        theme: string;
      };
    },
    _res: unknown,
    next: () => void
  ) => {
    req.user = {
      id: 1,
      username: "admin",
      permissions: 1,
      enabled: true,
      theme: "system",
    };
    next();
  },
}));

vi.mock("../middleware/requirePermission", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
}));

import express from "express";
import request from "supertest";
import settingsRouter from "./settings";

const app = express();
app.use(express.json());
app.use("/settings", settingsRouter);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /settings", () => {
  it("returns the full config", async () => {
    mockGetConfig.mockReturnValue({ lidarrUrl: "http://lidarr:8686" });
    const res = await request(app).get("/settings");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lidarrUrl: "http://lidarr:8686" });
  });
});

describe("PUT /settings", () => {
  it("saves valid config", async () => {
    const res = await request(app)
      .put("/settings")
      .send({ lidarrUrl: "http://lidarr:8686" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockSetConfig).toHaveBeenCalledWith({
      lidarrUrl: "http://lidarr:8686",
    });
  });

  it("hands the poller the pre-write live events state so it can spot a transition", async () => {
    const before = {
      configured: false,
      hasOrigin: false,
      sweepIntervalHours: 24,
    };
    mockSnapshotLiveEvents.mockReturnValue(before);

    const res = await request(app)
      .put("/settings")
      .send({ liveEvents: { apiKey: "k" } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockOnLiveEventsSaved).toHaveBeenCalledWith(before);
    expect(mockSnapshotLiveEvents.mock.invocationCallOrder[0]).toBeLessThan(
      mockSetConfig.mock.invocationCallOrder[0]
    );
  });

  it("leaves the live poller alone when the save has no liveEvents section", async () => {
    await request(app).put("/settings").send({ lastfmApiKey: "k" });

    expect(mockSnapshotLiveEvents).not.toHaveBeenCalled();
    expect(mockOnLiveEventsSaved).not.toHaveBeenCalled();
  });

  it("rejects an invalid import path", async () => {
    mockValidateWritableDirectory.mockReturnValue({
      valid: false,
      error: 'Path "/bad/path" does not exist.',
    });
    const res = await request(app)
      .put("/settings")
      .send({ importPath: "/bad/path" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("/bad/path");
    expect(mockSetConfig).not.toHaveBeenCalled();
  });

  it("accepts a valid import path", async () => {
    mockValidateWritableDirectory.mockReturnValue({ valid: true });
    const res = await request(app)
      .put("/settings")
      .send({ importPath: "/good/path" });
    expect(res.status).toBe(200);
    expect(mockValidateWritableDirectory).toHaveBeenCalledWith("/good/path");
  });
});

describe("POST /settings/validate-path", () => {
  it("returns valid for empty path", async () => {
    const res = await request(app)
      .post("/settings/validate-path")
      .send({ path: "" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true });
    expect(mockValidateWritableDirectory).not.toHaveBeenCalled();
  });

  it("returns valid for missing path", async () => {
    const res = await request(app).post("/settings/validate-path").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true });
  });

  it("returns valid for a writable directory", async () => {
    mockValidateWritableDirectory.mockReturnValue({ valid: true });
    const res = await request(app)
      .post("/settings/validate-path")
      .send({ path: "/good/path" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true });
    expect(mockValidateWritableDirectory).toHaveBeenCalledWith("/good/path");
  });

  it("returns 400 with the validation error for an invalid path", async () => {
    mockValidateWritableDirectory.mockReturnValue({
      valid: false,
      error: 'Tunearr does not have write permission for "/bad/path".',
    });
    const res = await request(app)
      .post("/settings/validate-path")
      .send({ path: "/bad/path" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("write permission");
  });
});

describe("GET /settings/browse", () => {
  it("returns directory suggestions", async () => {
    mockListDirectorySuggestions.mockReturnValue(["/imports", "/images"]);
    const res = await request(app).get("/settings/browse?path=/im");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ suggestions: ["/imports", "/images"] });
    expect(mockListDirectorySuggestions).toHaveBeenCalledWith("/im");
  });

  it("returns empty suggestions when path is missing", async () => {
    mockListDirectorySuggestions.mockReturnValue([]);
    const res = await request(app).get("/settings/browse");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ suggestions: [] });
    expect(mockListDirectorySuggestions).toHaveBeenCalledWith("");
  });
});

describe("POST /settings/test", () => {
  it("returns 400 without required fields", async () => {
    const res = await request(app).post("/settings/test").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("URL and API key are required");
  });

  it("returns error on failed Lidarr connection", async () => {
    mockTestLidarrConnection.mockResolvedValue({
      error: "Lidarr returned 401",
      status: 401,
    });

    const res = await request(app)
      .post("/settings/test")
      .send({ lidarrUrl: "http://lidarr:8686", lidarrApiKey: "badkey" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Lidarr returned 401");
  });

  it("returns success with version and profiles", async () => {
    mockTestLidarrConnection.mockResolvedValue({
      success: true,
      version: "2.0.0",
      qualityProfiles: [{ id: 1, name: "Any" }],
      metadataProfiles: [{ id: 1, name: "Standard" }],
      rootFolderPaths: [{ id: 1, path: "/music" }],
    });

    const res = await request(app)
      .post("/settings/test")
      .send({ lidarrUrl: "http://lidarr:8686", lidarrApiKey: "goodkey" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      version: "2.0.0",
      qualityProfiles: [{ id: 1, name: "Any" }],
      metadataProfiles: [{ id: 1, name: "Standard" }],
      rootFolderPaths: [{ id: 1, path: "/music" }],
    });
    expect(mockTestLidarrConnection).toHaveBeenCalledWith(
      "http://lidarr:8686",
      "goodkey"
    );
  });
});

describe("POST /settings/test-slskd", () => {
  it("returns 400 without required fields", async () => {
    const res = await request(app).post("/settings/test-slskd").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("URL and API key are required");
  });

  it("returns error on failed slskd connection", async () => {
    mockTestSlskdConnection.mockResolvedValue({
      error: "slskd returned 401",
      status: 401,
    });

    const res = await request(app)
      .post("/settings/test-slskd")
      .send({ slskdUrl: "http://slskd:5030", slskdApiKey: "badkey" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("slskd returned 401");
  });

  it("returns success with version and soulseek state", async () => {
    mockTestSlskdConnection.mockResolvedValue({
      success: true,
      version: "0.21.0",
      soulseekConnected: true,
    });

    const res = await request(app)
      .post("/settings/test-slskd")
      .send({ slskdUrl: "http://slskd:5030", slskdApiKey: "goodkey" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      version: "0.21.0",
      soulseekConnected: true,
    });
    expect(mockTestSlskdConnection).toHaveBeenCalledWith(
      "http://slskd:5030",
      "goodkey"
    );
  });
});
