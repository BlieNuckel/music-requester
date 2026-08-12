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
  deleteSubscriptionByEndpoint,
  deleteSubscriptionForUser,
  describeSelectableTransports,
  getEffectivePreferences,
  getTransport,
  getWebPushConfig,
  listSubscriptions,
  saveSubscription,
  setPreferences,
  toPushDevice,
  webPushTransport,
} from "../services/notifications";
import type {
  PreferenceEntry,
  PushSubscriptionInput,
} from "../services/notifications";

const router = express.Router();

router.use(requireAuth);

function parseSubscription(
  body: unknown
): Omit<PushSubscriptionInput, "userAgent"> {
  const subscription = body as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };

  if (
    typeof subscription?.endpoint !== "string" ||
    subscription.endpoint === ""
  ) {
    throw new ApiError(400, "endpoint is required");
  }
  if (
    typeof subscription.keys?.p256dh !== "string" ||
    typeof subscription.keys?.auth !== "string"
  ) {
    throw new ApiError(400, "keys.p256dh and keys.auth are required");
  }

  return {
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
  };
}

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

router.get("/webpush/key", (_req: Request, res: Response) => {
  res.json({ publicKey: getWebPushConfig().publicKey });
});

router.post("/webpush/subscribe", async (req: Request, res: Response) => {
  const subscription = parseSubscription(req.body);
  const device = await saveSubscription(req.user!.id, {
    ...subscription,
    userAgent: req.get("user-agent") ?? null,
  });
  res.json({ device });
});

router.post("/webpush/unsubscribe", async (req: Request, res: Response) => {
  const endpoint = (req.body as { endpoint?: unknown })?.endpoint;
  if (typeof endpoint !== "string" || endpoint === "") {
    throw new ApiError(400, "endpoint is required");
  }

  await deleteSubscriptionByEndpoint(endpoint);
  res.json({ status: "ok" });
});

/**
 * Self-service test. The admin-gated `/:transportId/test` below exists for
 * instance transports; verifying your own phone must not require ADMIN.
 */
router.post("/webpush/test", async (req: Request, res: Response) => {
  const subscriptions = await listSubscriptions(req.user!.id);
  if (subscriptions.length === 0) {
    throw new ApiError(400, "This account has no subscribed devices");
  }

  await webPushTransport.send(
    { userId: req.user!.id, username: req.user!.username },
    {
      eventId: "request.imported",
      title: "Tunearr test notification",
      body: "Push notifications are working on this device.",
      url: "/settings/notifications/mine",
    }
  );

  res.json({ status: "ok", deviceCount: subscriptions.length });
});

router.get("/devices", async (req: Request, res: Response) => {
  const subscriptions = await listSubscriptions(req.user!.id);
  res.json({ devices: subscriptions.map(toPushDevice) });
});

router.delete("/devices/:id", async (req: Request, res: Response) => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, "Invalid device id");
  }

  const removed = await deleteSubscriptionForUser(req.user!.id, id);
  if (!removed) {
    throw new ApiError(404, "Device not found");
  }

  res.json({ status: "ok" });
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
