import express, { type Request, type Response } from "express";
import { getNewReleases } from "../services/discover/newReleases";

const router = express.Router();

router.get("/new-releases", async (req: Request, res: Response) => {
  const result = await getNewReleases(req.user!.id);
  res.json(result);
});

export default router;
