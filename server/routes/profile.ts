import express, { type Request, type Response } from "express";
import { getProfileDebugSummaries } from "../services/profile/debugSummary";

const router = express.Router();

/**
 * Everything stored about every user's taste. ADMIN-gated at the mount, since it
 * reports on other people's listening.
 */
router.get("/debug", async (_req: Request, res: Response) => {
  res.json({ users: await getProfileDebugSummaries() });
});

export default router;
