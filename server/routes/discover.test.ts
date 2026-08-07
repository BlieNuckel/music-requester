import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetNewReleases = vi.fn();

vi.mock("../services/discover/newReleases", () => ({
  getNewReleases: (...args: unknown[]) => mockGetNewReleases(...args),
}));

import express from "express";
import request from "supertest";
import discoverRouter from "./discover";

const app = express();
app.use((req, _res, next) => {
  req.user = {
    id: 7,
    permissions: 9,
    username: "testuser",
    userType: "local",
    enabled: true,
    theme: "system",
    thumb: null,
  } as never;
  next();
});
app.use("/", discoverRouter);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /new-releases", () => {
  it("returns the blended result for the current user", async () => {
    const payload = {
      items: [
        {
          releaseGroupMbid: "rg-1",
          title: "Album",
          artistName: "Artist",
          artistMbid: "mbid-1",
          releaseDate: "2026-07-01",
          source: "followed",
          coverUrl: "https://caa/rg-1",
          lidarrStatus: null,
          followedReleaseId: 3,
        },
      ],
      windowDays: 30,
    };
    mockGetNewReleases.mockResolvedValue(payload);

    const res = await request(app).get("/new-releases");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);
    expect(mockGetNewReleases).toHaveBeenCalledWith(7);
  });
});
