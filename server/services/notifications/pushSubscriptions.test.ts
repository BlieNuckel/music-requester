import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  initializeDatabase,
  getDataSource,
  closeDatabase,
} from "../../db/index";
import {
  deleteSubscriptionByEndpoint,
  deleteSubscriptionForUser,
  listSubscriptions,
  saveSubscription,
} from "./pushSubscriptions";

const SUBSCRIPTION = {
  endpoint: "https://push.example/abc",
  p256dh: "key-p256dh",
  auth: "key-auth",
  userAgent: "Tunearr test agent",
};

async function createUser(username: string): Promise<number> {
  await getDataSource().query("INSERT INTO users (username) VALUES (?)", [
    username,
  ]);
  const [{ id }] = (await getDataSource().query(
    "SELECT id FROM users WHERE username = ?",
    [username]
  )) as { id: number }[];
  return id;
}

beforeEach(async () => {
  await initializeDatabase(":memory:");
});

afterEach(async () => {
  await closeDatabase();
});

describe("saveSubscription", () => {
  it("stores a new device", async () => {
    const userId = await createUser("alice");

    const device = await saveSubscription(userId, SUBSCRIPTION);

    expect(device.endpoint).toBe(SUBSCRIPTION.endpoint);
    expect(device.userAgent).toBe(SUBSCRIPTION.userAgent);
    expect(await listSubscriptions(userId)).toHaveLength(1);
  });

  it("refreshes an existing endpoint instead of duplicating it", async () => {
    const userId = await createUser("alice");

    await saveSubscription(userId, SUBSCRIPTION);
    await saveSubscription(userId, { ...SUBSCRIPTION, auth: "rotated-auth" });

    const rows = await listSubscriptions(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].auth).toBe("rotated-auth");
  });

  it("re-homes an endpoint when another user subscribes on the same browser", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");

    await saveSubscription(alice, SUBSCRIPTION);
    await saveSubscription(bob, SUBSCRIPTION);

    expect(await listSubscriptions(alice)).toHaveLength(0);
    expect(await listSubscriptions(bob)).toHaveLength(1);
  });

  it("keeps several devices for one user", async () => {
    const userId = await createUser("alice");

    await saveSubscription(userId, SUBSCRIPTION);
    await saveSubscription(userId, {
      ...SUBSCRIPTION,
      endpoint: "https://push.example/second",
    });

    expect(await listSubscriptions(userId)).toHaveLength(2);
  });
});

describe("deleteSubscriptionByEndpoint", () => {
  it("removes the row and reports whether anything was deleted", async () => {
    const userId = await createUser("alice");
    await saveSubscription(userId, SUBSCRIPTION);

    expect(await deleteSubscriptionByEndpoint(SUBSCRIPTION.endpoint)).toBe(
      true
    );
    expect(await deleteSubscriptionByEndpoint(SUBSCRIPTION.endpoint)).toBe(
      false
    );
    expect(await listSubscriptions(userId)).toHaveLength(0);
  });
});

describe("deleteSubscriptionForUser", () => {
  it("removes a device the user owns", async () => {
    const userId = await createUser("alice");
    const device = await saveSubscription(userId, SUBSCRIPTION);

    expect(await deleteSubscriptionForUser(userId, device.id)).toBe(true);
    expect(await listSubscriptions(userId)).toHaveLength(0);
  });

  it("refuses to remove another user's device", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");
    const device = await saveSubscription(alice, SUBSCRIPTION);

    expect(await deleteSubscriptionForUser(bob, device.id)).toBe(false);
    expect(await listSubscriptions(alice)).toHaveLength(1);
  });
});

describe("cascade", () => {
  it("drops subscriptions when the user is deleted", async () => {
    const userId = await createUser("alice");
    await saveSubscription(userId, SUBSCRIPTION);

    await getDataSource().query("DELETE FROM users WHERE id = ?", [userId]);

    expect(await listSubscriptions(userId)).toHaveLength(0);
  });
});
