import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLidarrGet = vi.fn();
const mockLidarrPost = vi.fn();
const mockGetConfigValue = vi.fn();

vi.mock("../../config", () => ({
  getConfigValue: (...args: unknown[]) => mockGetConfigValue(...args),
}));

vi.mock("../../api/lidarr/get.js", () => ({
  lidarrGet: (...args: unknown[]) => mockLidarrGet(...args),
}));

vi.mock("../../api/lidarr/post.js", () => ({
  lidarrPost: (...args: unknown[]) => mockLidarrPost(...args),
}));

import express from "express";
import request from "supertest";
import autoSetupRouter from "./autoSetup";

const app = express();
app.use(express.json());
app.use("/", autoSetupRouter);
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    res.status(500).json({ error: err.message });
  }
);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConfigValue.mockReturnValue("");
});

const newznabSchema = {
  id: 0,
  name: "",
  implementation: "Newznab",
  fields: [
    { name: "baseUrl", value: "" },
    { name: "apiPath", value: "/api" },
    { name: "apiKey", value: "" },
    { name: "categories", value: [3000] },
  ],
};

const sabnzbdSchema = {
  id: 0,
  name: "",
  implementation: "Sabnzbd",
  fields: [
    { name: "host", value: "localhost" },
    { name: "port", value: 8080 },
    { name: "apiKey", value: "" },
    { name: "password", value: "" },
    { name: "urlBase", value: "" },
    { name: "category", value: "" },
  ],
};

function mockSchemasAndClients(tunearrClientId = 42) {
  mockLidarrGet.mockImplementation((path: string) => {
    if (path === "/indexer/schema")
      return Promise.resolve({ data: [newznabSchema] });
    if (path === "/downloadclient/schema")
      return Promise.resolve({ data: [sabnzbdSchema] });
    if (path === "/downloadclient")
      return Promise.resolve({
        data: [{ id: tunearrClientId, name: "Tunearr" }],
      });
  });
}

describe("GET /auto-setup/status", () => {
  it("returns both false when no Tunearr entries exist", async () => {
    mockLidarrGet.mockImplementation((path: string) => {
      if (path === "/indexer")
        return Promise.resolve({
          data: [{ name: "Other Indexer", implementation: "Newznab" }],
        });
      if (path === "/downloadclient")
        return Promise.resolve({
          data: [{ name: "Other Client", implementation: "Sabnzbd" }],
        });
    });

    const res = await request(app).get("/auto-setup/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      indexerExists: false,
      downloadClientExists: false,
    });
  });

  it("returns both true when Tunearr entries exist", async () => {
    mockLidarrGet.mockImplementation((path: string) => {
      if (path === "/indexer")
        return Promise.resolve({
          data: [{ name: "Tunearr", implementation: "Newznab" }],
        });
      if (path === "/downloadclient")
        return Promise.resolve({
          data: [{ name: "Tunearr", implementation: "Sabnzbd" }],
        });
    });

    const res = await request(app).get("/auto-setup/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      indexerExists: true,
      downloadClientExists: true,
    });
  });

  it("returns mixed results when only indexer exists", async () => {
    mockLidarrGet.mockImplementation((path: string) => {
      if (path === "/indexer")
        return Promise.resolve({
          data: [{ name: "Tunearr", implementation: "Newznab" }],
        });
      if (path === "/downloadclient") return Promise.resolve({ data: [] });
    });

    const res = await request(app).get("/auto-setup/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      indexerExists: true,
      downloadClientExists: false,
    });
  });

  it("propagates Lidarr errors", async () => {
    mockLidarrGet.mockRejectedValue(new Error("Lidarr not configured"));

    const res = await request(app).get("/auto-setup/status");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Lidarr not configured");
  });
});

describe("POST /auto-setup", () => {
  it("returns 400 when host is missing", async () => {
    const res = await request(app).post("/auto-setup").send({ port: 3001 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("host and port are required");
  });

  it("returns 400 when port is missing", async () => {
    const res = await request(app)
      .post("/auto-setup")
      .send({ host: "tunearr" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("host and port are required");
  });

  it("creates download client first, then looks up its ID for the indexer", async () => {
    mockSchemasAndClients(42);
    mockLidarrPost.mockResolvedValue({ ok: true, data: {} });

    const res = await request(app)
      .post("/auto-setup")
      .send({ host: "tunearr", port: 3001 });

    expect(res.status).toBe(200);
    expect(res.body.downloadClient.success).toBe(true);
    expect(res.body.indexer.success).toBe(true);

    expect(mockLidarrPost).toHaveBeenCalledWith(
      "/downloadclient",
      expect.objectContaining({
        name: "Tunearr",
        enable: true,
        fields: expect.arrayContaining([
          { name: "host", value: "tunearr" },
          { name: "port", value: 3001 },
          { name: "apiKey", value: "a" },
          { name: "password", value: "a" },
          { name: "urlBase", value: "/api/sabnzbd" },
        ]),
      })
    );

    expect(mockLidarrGet).toHaveBeenCalledWith("/downloadclient");

    expect(mockLidarrPost).toHaveBeenCalledWith(
      "/indexer",
      expect.objectContaining({
        name: "Tunearr",
        enableRss: true,
        enableAutomaticSearch: true,
        enableInteractiveSearch: true,
        downloadClientId: 42,
        fields: expect.arrayContaining([
          { name: "baseUrl", value: "http://tunearr:3001/api/torznab" },
          { name: "apiPath", value: "" },
          { name: "apiKey", value: "a" },
        ]),
      })
    );
  });

  it("registers the configured indexer key with both Lidarr entries", async () => {
    mockGetConfigValue.mockReturnValue("s3cret");
    mockSchemasAndClients(42);
    mockLidarrPost.mockResolvedValue({ ok: true, data: {} });

    await request(app)
      .post("/auto-setup")
      .send({ host: "tunearr", port: 3001 });

    expect(mockGetConfigValue).toHaveBeenCalledWith("torznabApiKey");
    expect(mockLidarrPost).toHaveBeenCalledWith(
      "/downloadclient",
      expect.objectContaining({
        fields: expect.arrayContaining([{ name: "apiKey", value: "s3cret" }]),
      })
    );
    expect(mockLidarrPost).toHaveBeenCalledWith(
      "/indexer",
      expect.objectContaining({
        fields: expect.arrayContaining([{ name: "apiKey", value: "s3cret" }]),
      })
    );
  });

  it("returns error when Newznab schema is not found", async () => {
    mockLidarrGet.mockImplementation((path: string) => {
      if (path === "/indexer/schema")
        return Promise.resolve({ data: [{ implementation: "Other" }] });
      if (path === "/downloadclient/schema")
        return Promise.resolve({ data: [sabnzbdSchema] });
      if (path === "/downloadclient")
        return Promise.resolve({ data: [{ id: 1, name: "Tunearr" }] });
    });
    mockLidarrPost.mockResolvedValue({ ok: true, data: {} });

    const res = await request(app)
      .post("/auto-setup")
      .send({ host: "tunearr", port: 3001 });

    expect(res.status).toBe(200);
    expect(res.body.indexer.success).toBe(false);
    expect(res.body.indexer.error).toContain("Newznab schema not found");
    expect(res.body.downloadClient.success).toBe(true);
  });

  it("returns error when Sabnzbd schema is not found", async () => {
    mockLidarrGet.mockImplementation((path: string) => {
      if (path === "/indexer/schema")
        return Promise.resolve({ data: [newznabSchema] });
      if (path === "/downloadclient/schema")
        return Promise.resolve({ data: [{ implementation: "Other" }] });
    });
    mockLidarrPost.mockResolvedValue({ ok: true, data: {} });

    const res = await request(app)
      .post("/auto-setup")
      .send({ host: "tunearr", port: 3001 });

    expect(res.status).toBe(200);
    expect(res.body.downloadClient.success).toBe(false);
    expect(res.body.downloadClient.error).toContain("Sabnzbd schema not found");
    expect(res.body.indexer.success).toBe(false);
    expect(res.body.indexer.error).toContain(
      "download client must be created first"
    );
  });

  it("handles Lidarr POST failure for indexer", async () => {
    mockSchemasAndClients(5);
    mockLidarrPost.mockImplementation((path: string) => {
      if (path === "/indexer")
        return Promise.resolve({
          ok: false,
          data: [{ errorMessage: "Indexer already exists" }],
        });
      return Promise.resolve({ ok: true, data: {} });
    });

    const res = await request(app)
      .post("/auto-setup")
      .send({ host: "tunearr", port: 3001 });

    expect(res.status).toBe(200);
    expect(res.body.indexer.success).toBe(false);
    expect(res.body.indexer.error).toBe("Indexer already exists");
    expect(res.body.downloadClient.success).toBe(true);
  });

  it("handles Lidarr POST failure for download client", async () => {
    mockSchemasAndClients();
    mockLidarrPost.mockImplementation((path: string) => {
      if (path === "/downloadclient")
        return Promise.resolve({
          ok: false,
          data: { message: "Client validation failed" },
        });
      return Promise.resolve({ ok: true, data: {} });
    });

    const res = await request(app)
      .post("/auto-setup")
      .send({ host: "tunearr", port: 3001 });

    expect(res.status).toBe(200);
    expect(res.body.downloadClient.success).toBe(false);
    expect(res.body.downloadClient.error).toBe("Client validation failed");
    expect(res.body.indexer.success).toBe(false);
    expect(res.body.indexer.error).toContain(
      "download client must be created first"
    );
    expect(mockLidarrPost).not.toHaveBeenCalledWith(
      "/indexer",
      expect.anything()
    );
  });

  it("skips indexer when download client throws", async () => {
    mockSchemasAndClients();
    mockLidarrPost.mockImplementation((path: string) => {
      if (path === "/downloadclient")
        return Promise.reject(new Error("Network error"));
      return Promise.resolve({ ok: true, data: {} });
    });

    const res = await request(app)
      .post("/auto-setup")
      .send({ host: "tunearr", port: 3001 });

    expect(res.status).toBe(200);
    expect(res.body.downloadClient.success).toBe(false);
    expect(res.body.downloadClient.error).toBe("Network error");
    expect(res.body.indexer.success).toBe(false);
    expect(res.body.indexer.error).toContain(
      "download client must be created first"
    );
  });
});
