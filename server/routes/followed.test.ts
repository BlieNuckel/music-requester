import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFollow = vi.fn();
const mockUnfollow = vi.fn();
const mockGetFollowed = vi.fn();
const mockGetReleases = vi.fn();
const mockGetUnseen = vi.fn();
const mockMarkViewed = vi.fn();
const mockMarkOneViewed = vi.fn();
const mockRunPoll = vi.fn();

vi.mock("../services/followed/followedService", () => ({
  followArtist: (...args: unknown[]) => mockFollow(...args),
  unfollowArtist: (...args: unknown[]) => mockUnfollow(...args),
  getFollowedArtists: (...args: unknown[]) => mockGetFollowed(...args),
  getFollowedReleasesForUser: (...args: unknown[]) => mockGetReleases(...args),
  getUnseenReleaseCount: (...args: unknown[]) => mockGetUnseen(...args),
  markFollowedReleasesViewed: (...args: unknown[]) => mockMarkViewed(...args),
  markFollowedReleaseViewed: (...args: unknown[]) => mockMarkOneViewed(...args),
}));

vi.mock("../services/followed/poller", () => ({
  runPollOnce: (...args: unknown[]) => mockRunPoll(...args),
}));

vi.mock("../middleware/requireAuth", () => ({
  requireAuth: (req: { user: unknown }, _res: unknown, next: () => void) => {
    req.user = {
      id: 1,
      permissions: 9,
      username: "testuser",
      userType: "local",
      enabled: true,
      theme: "system",
      thumb: null,
    };
    next();
  },
}));

import express from "express";
import request from "supertest";
import followedRouter from "./followed";

const app = express();
app.use(express.json());
app.use("/", followedRouter);
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
});

describe("GET /", () => {
  it("returns sanitized follow list for the user", async () => {
    mockGetFollowed.mockResolvedValue([
      {
        id: 1,
        artist_mbid: "mbid-1",
        artist_name: "Artist",
        last_checked_at: null,
        created_at: "2024-01-01",
      },
    ]);

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: 1,
        artistMbid: "mbid-1",
        artistName: "Artist",
        lastCheckedAt: null,
        createdAt: "2024-01-01",
      },
    ]);
    expect(mockGetFollowed).toHaveBeenCalledWith(1);
  });
});

describe("GET /releases", () => {
  it("returns sanitized followed releases", async () => {
    mockGetReleases.mockResolvedValue([
      {
        id: 5,
        followed_artist_id: 1,
        artist_mbid: "mbid-1",
        artist_name: "Artist",
        release_key: "k",
        album_title: "Album",
        release_date: "2025-04-01",
        release_group_mbid: "rg-1",
        cover_url: "https://caa/rg-1",
        viewed_at: null,
        notified_at: "2025-04-02",
      },
    ]);

    const res = await request(app).get("/releases?limit=10");
    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual({
      id: 5,
      followedArtistId: 1,
      artistMbid: "mbid-1",
      artistName: "Artist",
      releaseKey: "k",
      albumTitle: "Album",
      releaseDate: "2025-04-01",
      releaseGroupMbid: "rg-1",
      coverUrl: "https://caa/rg-1",
      viewedAt: null,
      notifiedAt: "2025-04-02",
    });
    expect(mockGetReleases).toHaveBeenCalledWith(1, 10);
  });

  it("clamps limit to default when missing", async () => {
    mockGetReleases.mockResolvedValue([]);
    await request(app).get("/releases");
    expect(mockGetReleases).toHaveBeenCalledWith(1, 50);
  });

  it("clamps oversized limit", async () => {
    mockGetReleases.mockResolvedValue([]);
    await request(app).get("/releases?limit=99999");
    expect(mockGetReleases).toHaveBeenCalledWith(1, 200);
  });
});

describe("POST /releases/:id/viewed", () => {
  it("marks a single release viewed", async () => {
    mockMarkOneViewed.mockResolvedValue(true);
    const res = await request(app).post("/releases/42/viewed");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(mockMarkOneViewed).toHaveBeenCalledWith(1, 42);
  });

  it("returns 404 when the release isn't the user's", async () => {
    mockMarkOneViewed.mockResolvedValue(false);
    const res = await request(app).post("/releases/42/viewed");
    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-numeric id", async () => {
    const res = await request(app).post("/releases/abc/viewed");
    expect(res.status).toBe(400);
    expect(mockMarkOneViewed).not.toHaveBeenCalled();
  });
});

describe("POST /", () => {
  it("returns 400 when artistMbid is missing", async () => {
    const res = await request(app).post("/").send({ artistName: "X" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("artistMbid is required");
  });

  it("returns 400 when artistName is missing", async () => {
    const res = await request(app).post("/").send({ artistMbid: "mbid-1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("artistName is required");
  });

  it("creates a follow row", async () => {
    mockFollow.mockResolvedValue({ status: "added", id: 7 });
    const res = await request(app)
      .post("/")
      .send({ artistMbid: "mbid-1", artistName: "Artist" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "added", id: 7 });
    expect(mockFollow).toHaveBeenCalledWith(1, "mbid-1", "Artist");
  });

  it("returns already_following when row exists", async () => {
    mockFollow.mockResolvedValue({ status: "already_following", id: 3 });
    const res = await request(app)
      .post("/")
      .send({ artistMbid: "mbid-1", artistName: "Artist" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("already_following");
  });
});

describe("GET /unseen-count", () => {
  it("returns the count from the service", async () => {
    mockGetUnseen.mockResolvedValue(4);
    const res = await request(app).get("/unseen-count");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 4 });
    expect(mockGetUnseen).toHaveBeenCalledWith(1);
  });
});

describe("POST /mark-viewed", () => {
  it("calls service for current user", async () => {
    mockMarkViewed.mockResolvedValue(undefined);
    const res = await request(app).post("/mark-viewed");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(mockMarkViewed).toHaveBeenCalledWith(1);
  });
});

describe("DELETE /:artistMbid", () => {
  it("returns 404 when row missing", async () => {
    mockUnfollow.mockResolvedValue({ status: "not_found" });
    const res = await request(app).delete("/mbid-1");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Followed artist not found");
  });

  it("removes follow row", async () => {
    mockUnfollow.mockResolvedValue({ status: "removed" });
    const res = await request(app).delete("/mbid-1");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("removed");
    expect(mockUnfollow).toHaveBeenCalledWith(1, "mbid-1");
  });
});
