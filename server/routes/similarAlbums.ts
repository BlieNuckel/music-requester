import type { Request, Response } from "express";
import express from "express";
import { getSimilarAlbums } from "../services/similarAlbums";

const router = express.Router();

router.get("/", async (req: Request, res: Response) => {
  const { mbid } = req.query;
  if (typeof mbid !== "string" || !mbid) {
    return res.status(400).json({ error: "mbid query parameter is required" });
  }

  res.json({ albums: await getSimilarAlbums(mbid) });
});

export default router;
