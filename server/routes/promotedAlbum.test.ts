import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

const mockGetPromotedAlbums = vi.fn();

vi.mock("../promotedAlbum/getPromotedAlbum", () => ({
  getPromotedAlbums: (...args: unknown[]) => mockGetPromotedAlbums(...args),
}));

import express from "express";
import request from "supertest";
import promotedAlbumRouter from "./promotedAlbum";

function withUser(plexToken?: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = {
      id: 1,
      username: "test",
      userType: "local" as const,
      permissions: 0,
      enabled: true,
      theme: "system" as const,
      thumb: null,
      hasPlexToken: !!plexToken,
      plexToken: plexToken ?? null,
    };
    next();
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /", () => {
  it("returns the promoted album list", async () => {
    const app = express();
    app.use(withUser("plex-token-123"));
    app.use("/", promotedAlbumRouter);

    const data = [
      {
        album: {
          name: "OK Computer",
          mbid: "alb-1",
          artistName: "Radiohead",
          artistMbid: "art-1",
          coverUrl: "https://coverartarchive.org/release-group/alb-1/front-500",
          year: "1997",
        },
        tag: "alternative",
        inLibrary: false,
      },
      {
        album: {
          name: "Homogenic",
          mbid: "alb-2",
          artistName: "Bjork",
          artistMbid: "art-2",
          coverUrl: "https://coverartarchive.org/release-group/alb-2/front-500",
          year: "1997",
        },
        tag: "trip hop",
        inLibrary: false,
      },
    ];
    mockGetPromotedAlbums.mockResolvedValue({ status: "ready", albums: data });

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready", albums: data });
    expect(mockGetPromotedAlbums).toHaveBeenCalledWith(1, false);
  });

  it("returns an empty list when no albums are found", async () => {
    const app = express();
    app.use(withUser("plex-token-123"));
    app.use("/", promotedAlbumRouter);

    mockGetPromotedAlbums.mockResolvedValue({ status: "ready", albums: [] });

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready", albums: [] });
  });

  it("passes the building status through so the client can tell it apart", async () => {
    const app = express();
    app.use(withUser("plex-token-123"));
    app.use("/", promotedAlbumRouter);

    mockGetPromotedAlbums.mockResolvedValue({ status: "building", albums: [] });

    const res = await request(app).get("/");
    expect(res.body).toEqual({ status: "building", albums: [] });
  });

  it("forwards refresh param as forceRefresh", async () => {
    const app = express();
    app.use(withUser("plex-token-123"));
    app.use("/", promotedAlbumRouter);

    mockGetPromotedAlbums.mockResolvedValue({ status: "ready", albums: [] });

    await request(app).get("/?refresh=true");
    expect(mockGetPromotedAlbums).toHaveBeenCalledWith(1, true);
  });

  it("returns an empty list without calling the service when there is no authenticated user", async () => {
    const app = express();
    app.use("/", promotedAlbumRouter);

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready", albums: [] });
    expect(mockGetPromotedAlbums).not.toHaveBeenCalled();
  });
});
