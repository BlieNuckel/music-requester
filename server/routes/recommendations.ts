import express, { type Request, type Response } from "express";
import {
  buildFlowShape,
  buildRecommenderGraph,
} from "../recommenderGraph/graph";
import { requireAuth } from "../middleware/requireAuth";
import { requirePermission } from "../middleware/requirePermission";
import { Permission } from "../../shared/permissions";

const router = express.Router();

router.use(requireAuth);

/**
 * The spotlight flow's shape, which is the chart a recommendation's trace is drawn on. Open
 * to anyone who can be shown a recommendation, and knobless: {@link buildFlowShape} strips
 * the params, so asking why you were shown a record does not hand you the settings page.
 */
router.get("/graph/spotlight", (_req: Request, res: Response) => {
  res.json(buildFlowShape("spotlight"));
});

/**
 * The declared recommender pipeline. Static: it describes the code rather than any user's
 * data, so it carries no values and needs no per-user work.
 */
router.get(
  "/graph",
  requirePermission(Permission.ADMIN),
  (_req: Request, res: Response) => {
    res.json(buildRecommenderGraph());
  }
);

export default router;
