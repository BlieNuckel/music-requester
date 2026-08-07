import express, { type Request, type Response } from "express";
import { requireAuth } from "../middleware/requireAuth";
import {
  followArtist,
  unfollowArtist,
  getFollowedArtists,
  getFollowedReleasesForUser,
  getUnseenReleaseCount,
  markFollowedReleasesViewed,
  markFollowedReleaseViewed,
} from "../services/followed/followedService";
import { runPollOnce } from "../services/followed/poller";

const router = express.Router();

router.use(requireAuth);

router.get("/", async (req: Request, res: Response) => {
  const items = await getFollowedArtists(req.user!.id);
  res.json(
    items.map((item) => ({
      id: item.id,
      artistMbid: item.artist_mbid,
      artistName: item.artist_name,
      lastCheckedAt: item.last_checked_at,
      createdAt: item.created_at,
    }))
  );
});

router.get("/releases", async (req: Request, res: Response) => {
  const limit = Math.min(
    Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
    200
  );
  const rows = await getFollowedReleasesForUser(req.user!.id, limit);
  res.json(
    rows.map((r) => ({
      id: r.id,
      followedArtistId: r.followed_artist_id,
      artistMbid: r.artist_mbid,
      artistName: r.artist_name,
      releaseKey: r.release_key,
      albumTitle: r.album_title,
      releaseDate: r.release_date,
      releaseGroupMbid: r.release_group_mbid,
      coverUrl: r.cover_url,
      viewedAt: r.viewed_at,
      notifiedAt: r.notified_at,
    }))
  );
});

router.post("/releases/:id/viewed", async (req: Request, res: Response) => {
  const releaseId = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(releaseId) || releaseId <= 0) {
    return res.status(400).json({ error: "Invalid release id" });
  }

  const marked = await markFollowedReleaseViewed(req.user!.id, releaseId);
  if (!marked) {
    return res.status(404).json({ error: "Release not found" });
  }

  res.json({ status: "ok" });
});

router.post("/", async (req: Request, res: Response) => {
  const { artistMbid, artistName } = req.body ?? {};

  if (typeof artistMbid !== "string" || artistMbid.trim() === "") {
    return res.status(400).json({ error: "artistMbid is required" });
  }
  if (typeof artistName !== "string" || artistName.trim() === "") {
    return res.status(400).json({ error: "artistName is required" });
  }

  const result = await followArtist(req.user!.id, artistMbid, artistName);
  res.json(result);
});

router.get("/unseen-count", async (req: Request, res: Response) => {
  const count = await getUnseenReleaseCount(req.user!.id);
  res.json({ count });
});

router.post("/mark-viewed", async (req: Request, res: Response) => {
  await markFollowedReleasesViewed(req.user!.id);
  res.json({ status: "ok" });
});

router.post("/poll-now", async (_req: Request, res: Response) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" });
  }
  await runPollOnce();
  res.json({ status: "ok" });
});

router.delete("/:artistMbid", async (req: Request, res: Response) => {
  const artistMbid = req.params.artistMbid as string;
  const result = await unfollowArtist(req.user!.id, artistMbid);

  if (result.status === "not_found") {
    return res.status(404).json({ error: "Followed artist not found" });
  }

  res.json(result);
});

export default router;
