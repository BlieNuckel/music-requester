import express, { type Request, type Response } from "express";
import { ApiError } from "../middleware/ApiError";
import { requireAuth } from "../middleware/requireAuth";
import { requirePermission } from "../middleware/requirePermission";
import { getConfigValue } from "../config";
import {
  NOTIFICATION_EVENTS,
  isNotificationEventId,
} from "../../shared/notificationEvents";
import { Permission } from "../../shared/permissions";
import {
  describeSelectableTransports,
  getEffectivePreferences,
  getTransport,
  setPreferences,
} from "../services/notifications";
import type { PreferenceEntry } from "../services/notifications";

const router = express.Router();

router.use(requireAuth);

function parsePreferences(body: unknown): PreferenceEntry[] {
  const entries = (body as { preferences?: unknown })?.preferences;
  if (!Array.isArray(entries)) {
    throw new ApiError(400, "preferences must be an array");
  }

  return entries.map((raw) => {
    const entry = raw as Partial<PreferenceEntry>;
    if (!isNotificationEventId(entry.eventId)) {
      throw new ApiError(400, `Unknown notification event: ${entry.eventId}`);
    }
    if (
      typeof entry.transportId !== "string" ||
      !getTransport(entry.transportId)
    ) {
      throw new ApiError(
        400,
        `Unknown notification transport: ${entry.transportId}`
      );
    }
    if (typeof entry.enabled !== "boolean") {
      throw new ApiError(400, "enabled must be a boolean");
    }
    return {
      eventId: entry.eventId,
      transportId: entry.transportId,
      enabled: entry.enabled,
    };
  });
}

router.get("/catalog", (_req: Request, res: Response) => {
  res.json({
    enabled: getConfigValue("notifications").enabled,
    events: NOTIFICATION_EVENTS,
    transports: describeSelectableTransports(),
  });
});

router.get("/preferences", async (req: Request, res: Response) => {
  res.json({ preferences: await getEffectivePreferences(req.user!.id) });
});

router.put("/preferences", async (req: Request, res: Response) => {
  const entries = parsePreferences(req.body);
  const preferences = await setPreferences(req.user!.id, entries);
  res.json({ preferences });
});

router.post(
  "/:transportId/test",
  requirePermission(Permission.ADMIN),
  async (req: Request, res: Response) => {
    const transport = getTransport(String(req.params.transportId));
    if (!transport || transport.internal) {
      throw new ApiError(
        404,
        `Unknown notification transport: ${req.params.transportId}`
      );
    }
    if (!transport.isConfigured()) {
      throw new ApiError(400, `${transport.label} is not configured yet`);
    }

    await transport.send(
      { userId: req.user!.id, username: req.user!.username },
      {
        eventId: "request.approved",
        title: "Tunearr test notification",
        body: `This is a test notification from Tunearr via ${transport.label}.`,
        url: "/settings/notifications",
      }
    );

    res.json({ status: "ok" });
  }
);

export default router;
