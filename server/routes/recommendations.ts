import express, { type Request, type Response } from "express";
import { buildRecommenderGraph } from "../recommenderGraph/graph";
import { requireAuth } from "../middleware/requireAuth";
import { requirePermission } from "../middleware/requirePermission";
import { Permission } from "../../shared/permissions";

const router = express.Router();

router.use(requireAuth, requirePermission(Permission.ADMIN));

/**
 * The declared recommender pipeline. Static: it describes the code rather than any user's
 * data, so it carries no values and needs no per-user work.
 */
router.get("/graph", (_req: Request, res: Response) => {
  res.json(buildRecommenderGraph());
});

export default router;
