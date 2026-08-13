import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetConfigValue = vi.fn();

vi.mock("../config", () => ({
  getConfigValue: (...args: unknown[]) => mockGetConfigValue(...args),
}));

import express from "express";
import request from "supertest";
import { requireIndexerKey } from "./requireIndexerKey";

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(requireIndexerKey);
app.get("/test", (_req, res) => {
  res.json({ ok: true });
});
app.post("/test", (_req, res) => {
  res.json({ ok: true });
});
app.use(
  (
    err: Error & { status?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    res.status(err.status || 500).json({ error: err.message });
  }
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireIndexerKey", () => {
  it("passes every request through when no key is configured", async () => {
    mockGetConfigValue.mockReturnValue("");

    const res = await request(app).get("/test");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("reads the configured key from torznabApiKey", async () => {
    mockGetConfigValue.mockReturnValue("");

    await request(app).get("/test");

    expect(mockGetConfigValue).toHaveBeenCalledWith("torznabApiKey");
  });

  it("accepts a matching apikey query parameter", async () => {
    mockGetConfigValue.mockReturnValue("s3cret");

    const res = await request(app).get("/test?apikey=s3cret");

    expect(res.status).toBe(200);
  });

  it("accepts a matching apikey in a form-encoded body", async () => {
    mockGetConfigValue.mockReturnValue("s3cret");

    const res = await request(app).post("/test").send("apikey=s3cret");

    expect(res.status).toBe(200);
  });

  it("rejects a missing apikey once a key is configured", async () => {
    mockGetConfigValue.mockReturnValue("s3cret");

    const res = await request(app).get("/test");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid or missing apikey");
  });

  it("rejects a wrong apikey", async () => {
    mockGetConfigValue.mockReturnValue("s3cret");

    const res = await request(app).get("/test?apikey=nope");

    expect(res.status).toBe(401);
  });

  it("rejects a key that only shares a prefix", async () => {
    mockGetConfigValue.mockReturnValue("s3cret");

    const res = await request(app).get("/test?apikey=s3c");

    expect(res.status).toBe(401);
  });

  it("rejects a repeated apikey parameter rather than trusting the array", async () => {
    mockGetConfigValue.mockReturnValue("s3cret");

    const res = await request(app).get("/test?apikey=nope&apikey=s3cret");

    expect(res.status).toBe(401);
  });
});
