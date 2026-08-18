import type { Request, Response } from "express";
import express from "express";
import { getConfig, setConfig } from "../config";
import {
  listDirectorySuggestions,
  validateWritableDirectory,
} from "../services/pathValidation";
import { clearPromotedAlbumCache } from "../promotedAlbum/getPromotedAlbum";
import { clearPromotedArtistsCache } from "../promotedArtists/getPromotedArtists";
import {
  onLiveEventsSettingsSaved,
  snapshotLiveEventsSettings,
} from "../services/liveEvents/settingsChange";
import { testLidarrConnection } from "../services/settings";
import { testSlskdConnection } from "../api/slskd/testConnection";
import { requireAuth } from "../middleware/requireAuth";
import { requirePermission } from "../middleware/requirePermission";
import { Permission } from "../../shared/permissions";

const router = express.Router();

router.get("/status", requireAuth, (_req: Request, res: Response) => {
  const config = getConfig();
  res.json({ configured: Boolean(config.lidarrUrl && config.lidarrApiKey) });
});

router.use(requireAuth, requirePermission(Permission.ADMIN));

router.get("/", (_req: Request, res: Response) => {
  const fullConfig = getConfig();

  res.json(fullConfig);
});

router.put("/", (req: Request, res: Response) => {
  const partialConfig = req.body;

  if (partialConfig.importPath) {
    const result = validateWritableDirectory(partialConfig.importPath);
    if (!result.valid) {
      return res.status(400).json({ error: result.error });
    }
  }

  const liveEventsBefore = partialConfig.liveEvents
    ? snapshotLiveEventsSettings()
    : null;

  setConfig(partialConfig);

  if (partialConfig.promotedAlbum) {
    clearPromotedAlbumCache();
    clearPromotedArtistsCache();
  }

  if (liveEventsBefore) {
    onLiveEventsSettingsSaved(liveEventsBefore);
  }

  res.json({ success: true });
});

router.post("/validate-path", (req: Request, res: Response) => {
  const { path: dirPath } = req.body;

  if (!dirPath) {
    return res.json({ valid: true });
  }

  const result = validateWritableDirectory(dirPath);
  if (!result.valid) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ valid: true });
});

router.get("/browse", (req: Request, res: Response) => {
  const dirPath = typeof req.query.path === "string" ? req.query.path : "";
  res.json({ suggestions: listDirectorySuggestions(dirPath) });
});

router.post("/test", async (req: Request, res: Response) => {
  const { lidarrUrl, lidarrApiKey } = req.body;
  if (!lidarrUrl || !lidarrApiKey) {
    return res.status(400).json({ error: "URL and API key are required" });
  }

  const result = await testLidarrConnection(lidarrUrl, lidarrApiKey);
  if ("error" in result) {
    return res.status(result.status).json({ error: result.error });
  }

  res.json(result);
});

router.post("/test-slskd", async (req: Request, res: Response) => {
  const { slskdUrl, slskdApiKey } = req.body;
  if (!slskdUrl || !slskdApiKey) {
    return res.status(400).json({ error: "URL and API key are required" });
  }

  const result = await testSlskdConnection(slskdUrl, slskdApiKey);
  if ("error" in result) {
    return res.status(result.status).json({ error: result.error });
  }

  res.json(result);
});

export default router;
