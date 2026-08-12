import type { Request, Response } from "express";
import express from "express";
import { getPromotedAlbums } from "../promotedAlbum/getPromotedAlbum";

const router = express.Router();

router.get("/", async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.json([]);
    return;
  }
  const forceRefresh = req.query.refresh === "true";
  const results = await getPromotedAlbums(userId, forceRefresh);
  res.json(results);
});

export default router;
