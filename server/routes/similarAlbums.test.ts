import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSimilarAlbums = vi.fn();

vi.mock("../services/similarAlbums", () => ({
  getSimilarAlbums: (...args: unknown[]) => mockGetSimilarAlbums(...args),
}));

import express from "express";
import request from "supertest";
import similarAlbumsRouter from "./similarAlbums";

const app = express();
app.use("/", similarAlbumsRouter);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /similar-albums", () => {
  it("returns 400 when mbid is missing", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("mbid");
  });

  it("returns 400 when mbid is empty", async () => {
    const res = await request(app).get("/?mbid=");
    expect(res.status).toBe(400);
    expect(mockGetSimilarAlbums).not.toHaveBeenCalled();
  });

  it("returns the synthesized albums", async () => {
    const albums = [
      {
        mbid: "mbv-loveless",
        title: "Loveless",
        artistName: "My Bloody Valentine",
        artistMbid: "mbv-mbid",
        year: "1991",
        score: 0.8,
        reasons: ["tag", "artist"],
      },
    ];
    mockGetSimilarAlbums.mockResolvedValue(albums);

    const res = await request(app).get("/?mbid=seed-rg");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ albums });
    expect(mockGetSimilarAlbums).toHaveBeenCalledWith("seed-rg");
  });

  it("returns an empty list rather than an error when nothing is found", async () => {
    mockGetSimilarAlbums.mockResolvedValue([]);

    const res = await request(app).get("/?mbid=seed-rg");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ albums: [] });
  });
});
