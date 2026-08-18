import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSummaries = vi.fn();

vi.mock("../services/profile/debugSummary", () => ({
  getProfileDebugSummaries: () => mockGetSummaries(),
}));

import express from "express";
import request from "supertest";
import profileRouter from "./profile";

const app = express();
app.use(express.json());
app.use("/", profileRouter);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /debug", () => {
  it("returns the summaries under a users key", async () => {
    mockGetSummaries.mockResolvedValue([{ userId: 1, username: "lasse" }]);

    const res = await request(app).get("/debug");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ users: [{ userId: 1, username: "lasse" }] });
  });

  it("returns an empty list rather than 404 when there is nothing", async () => {
    mockGetSummaries.mockResolvedValue([]);

    const res = await request(app).get("/debug");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ users: [] });
  });
});
