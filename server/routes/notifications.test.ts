import { describe, it, expect, vi, beforeEach } from "vitest";
import { Permission } from "../../shared/permissions";

const mockGetPreferences = vi.fn();
const mockSetPreferences = vi.fn();
const mockDescribeTransports = vi.fn();
const mockGetTransport = vi.fn();
const mockGetConfigValue = vi.fn();

let currentUser = {
  id: 1,
  username: "testuser",
  permissions: Permission.REQUEST,
  userType: "local",
  enabled: true,
  theme: "system",
  thumb: null,
};

vi.mock("../services/notifications", () => ({
  getEffectivePreferences: (...args: unknown[]) => mockGetPreferences(...args),
  setPreferences: (...args: unknown[]) => mockSetPreferences(...args),
  describeSelectableTransports: (...args: unknown[]) =>
    mockDescribeTransports(...args),
  getTransport: (...args: unknown[]) => mockGetTransport(...args),
}));

vi.mock("../config", () => ({
  getConfigValue: (...args: unknown[]) => mockGetConfigValue(...args),
}));

vi.mock("../middleware/requireAuth", () => ({
  requireAuth: (req: { user: unknown }, _res: unknown, next: () => void) => {
    req.user = currentUser;
    next();
  },
}));

import express from "express";
import request from "supertest";
import notificationsRouter from "./notifications";

const app = express();
app.use(express.json());
app.use("/", notificationsRouter);
app.use(
  (
    err: Error & { status?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    res.status(err.status ?? 500).json({ error: err.message });
  }
);

function asAdmin() {
  currentUser = { ...currentUser, permissions: Permission.ADMIN };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = {
    id: 1,
    username: "testuser",
    permissions: Permission.REQUEST,
    userType: "local",
    enabled: true,
    theme: "system",
    thumb: null,
  };
  mockGetConfigValue.mockReturnValue({ enabled: true });
  mockDescribeTransports.mockReturnValue([
    { id: "webpush", label: "Web push", configured: false },
  ]);
  mockGetTransport.mockReturnValue({
    id: "webpush",
    label: "Web push",
    isConfigured: () => true,
    send: vi.fn().mockResolvedValue(undefined),
  });
});

describe("GET /catalog", () => {
  it("returns the event catalog, transports, and enabled flag", async () => {
    const res = await request(app).get("/catalog");

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.transports).toEqual([
      { id: "webpush", label: "Web push", configured: false },
    ]);
    expect(res.body.events.length).toBeGreaterThan(0);
    expect(res.body.events[0]).toHaveProperty("audience");
  });
});

describe("GET /preferences", () => {
  it("returns the caller's effective preferences", async () => {
    mockGetPreferences.mockResolvedValue([
      { eventId: "request.approved", transportId: "webpush", enabled: true },
    ]);

    const res = await request(app).get("/preferences");

    expect(res.status).toBe(200);
    expect(mockGetPreferences).toHaveBeenCalledWith(1);
    expect(res.body.preferences).toHaveLength(1);
  });
});

describe("PUT /preferences", () => {
  it("saves valid entries and returns the updated set", async () => {
    mockSetPreferences.mockResolvedValue([
      { eventId: "request.approved", transportId: "webpush", enabled: false },
    ]);

    const res = await request(app)
      .put("/preferences")
      .send({
        preferences: [
          {
            eventId: "request.approved",
            transportId: "webpush",
            enabled: false,
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(mockSetPreferences).toHaveBeenCalledWith(1, [
      { eventId: "request.approved", transportId: "webpush", enabled: false },
    ]);
    expect(res.body.preferences[0].enabled).toBe(false);
  });

  it("rejects a non-array body", async () => {
    const res = await request(app).put("/preferences").send({});

    expect(res.status).toBe(400);
    expect(mockSetPreferences).not.toHaveBeenCalled();
  });

  it("rejects unknown events", async () => {
    const res = await request(app)
      .put("/preferences")
      .send({
        preferences: [
          { eventId: "nope", transportId: "webpush", enabled: true },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown notification event/);
  });

  it("rejects unknown transports", async () => {
    mockGetTransport.mockReturnValue(undefined);

    const res = await request(app)
      .put("/preferences")
      .send({
        preferences: [
          { eventId: "request.approved", transportId: "pigeon", enabled: true },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown notification transport/);
  });

  it("rejects a non-boolean enabled", async () => {
    const res = await request(app)
      .put("/preferences")
      .send({
        preferences: [
          {
            eventId: "request.approved",
            transportId: "webpush",
            enabled: "yes",
          },
        ],
      });

    expect(res.status).toBe(400);
  });
});

describe("POST /:transportId/test", () => {
  it("requires admin", async () => {
    const res = await request(app).post("/webpush/test");

    expect(res.status).toBe(403);
  });

  it("sends a test notification to the caller", async () => {
    asAdmin();
    const send = vi.fn().mockResolvedValue(undefined);
    mockGetTransport.mockReturnValue({
      id: "webpush",
      label: "Web push",
      isConfigured: () => true,
      send,
    });

    const res = await request(app).post("/webpush/test");

    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toEqual({ userId: 1, username: "testuser" });
  });

  it("404s for an unknown transport", async () => {
    asAdmin();
    mockGetTransport.mockReturnValue(undefined);

    const res = await request(app).post("/pigeon/test");

    expect(res.status).toBe(404);
  });

  it("404s for an internal transport", async () => {
    asAdmin();
    mockGetTransport.mockReturnValue({
      id: "log",
      label: "Server log",
      internal: true,
      isConfigured: () => true,
      send: vi.fn(),
    });

    const res = await request(app).post("/log/test");

    expect(res.status).toBe(404);
  });

  it("400s when the transport is not configured", async () => {
    asAdmin();
    mockGetTransport.mockReturnValue({
      id: "webpush",
      label: "Web push",
      isConfigured: () => false,
      send: vi.fn(),
    });

    const res = await request(app).post("/webpush/test");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not configured/);
  });
});
