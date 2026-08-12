import { getDataSource, PushSubscription } from "../../db/index";

export type PushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
};

export type PushDevice = {
  id: number;
  endpoint: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
};

function getRepo() {
  return getDataSource().getRepository(PushSubscription);
}

export function toPushDevice(row: PushSubscription): PushDevice {
  return {
    id: row.id,
    endpoint: row.endpoint,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function listSubscriptions(userId: number): Promise<PushSubscription[]> {
  return getRepo().find({
    where: { user_id: userId },
    order: { last_seen_at: "DESC" },
  });
}

/**
 * Re-subscribing a device yields the same endpoint, so an existing row is
 * refreshed rather than duplicated. The row is also re-homed if the device now
 * belongs to a different user, which happens when two people share a browser.
 */
export async function saveSubscription(
  userId: number,
  input: PushSubscriptionInput
): Promise<PushDevice> {
  const repo = getRepo();
  const now = new Date().toISOString();

  const existing = await repo.findOne({ where: { endpoint: input.endpoint } });
  if (existing) {
    existing.user_id = userId;
    existing.p256dh = input.p256dh;
    existing.auth = input.auth;
    existing.user_agent = input.userAgent;
    existing.last_seen_at = now;
    return toPushDevice(await repo.save(existing));
  }

  const saved = await repo.save(
    repo.create({
      user_id: userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      user_agent: input.userAgent,
      last_seen_at: now,
    })
  );
  return toPushDevice(saved);
}

export async function deleteSubscriptionByEndpoint(
  endpoint: string
): Promise<boolean> {
  const result = await getRepo().delete({ endpoint });
  return (result.affected ?? 0) > 0;
}

export async function deleteSubscriptionForUser(
  userId: number,
  id: number
): Promise<boolean> {
  const result = await getRepo().delete({ id, user_id: userId });
  return (result.affected ?? 0) > 0;
}
