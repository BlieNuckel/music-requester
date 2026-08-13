import type { Request, Response } from "express";
import express from "express";
import { getPromotedAlbums } from "../promotedAlbum/getPromotedAlbum";

const router = express.Router();

router.get("/", async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.json({ status: "ready", albums: [] });
    return;
  }
  const forceRefresh = req.query.refresh === "true";
  res.json(await getPromotedAlbums(userId, forceRefresh));
});

export default router;
