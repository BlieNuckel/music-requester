import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  initializeDatabase,
  getDataSource,
  closeDatabase,
} from "../../db/index";
import { getNotificationEvent } from "../../../shared/notificationEvents";
import {
  getEffectivePreferences,
  isEventEnabled,
  setPreferences,
} from "./preferences";
import { clearTransports, registerTransport } from "./registry";
import type { NotificationTransport } from "./types";

const pushTransport: NotificationTransport = {
  id: "webpush",
  label: "Web push",
  isConfigured: () => true,
  send: () => Promise.resolve(),
};

const logTransport: NotificationTransport = {
  id: "log",
  label: "Server log",
  internal: true,
  isConfigured: () => true,
  send: () => Promise.resolve(),
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
  clearTransports();
  registerTransport(pushTransport);
  registerTransport(logTransport);
});

afterEach(async () => {
  await closeDatabase();
});

describe("getEffectivePreferences", () => {
  it("falls back to catalog defaults for a user with no stored rows", async () => {
    const userId = await createUser("alice");

    const prefs = await getEffectivePreferences(userId);
    const approved = prefs.find((p) => p.eventId === "request.approved");
    const downloading = prefs.find((p) => p.eventId === "request.downloading");

    expect(approved?.enabled).toBe(
      getNotificationEvent("request.approved").defaultEnabled
    );
    expect(downloading?.enabled).toBe(
      getNotificationEvent("request.downloading").defaultEnabled
    );
  });

  it("only covers selectable transports", async () => {
    const userId = await createUser("alice");

    const transportIds = new Set(
      (await getEffectivePreferences(userId)).map((p) => p.transportId)
    );

    expect([...transportIds]).toEqual(["webpush"]);
  });

  it("applies stored overrides on top of defaults", async () => {
    const userId = await createUser("alice");

    await setPreferences(userId, [
      { eventId: "request.approved", transportId: "webpush", enabled: false },
    ]);

    const prefs = await getEffectivePreferences(userId);
    expect(prefs.find((p) => p.eventId === "request.approved")?.enabled).toBe(
      false
    );
    expect(prefs.find((p) => p.eventId === "request.imported")?.enabled).toBe(
      true
    );
  });

  it("keeps preferences separate per user", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");

    await setPreferences(alice, [
      { eventId: "request.imported", transportId: "webpush", enabled: false },
    ]);

    expect(await isEventEnabled(alice, "request.imported", "webpush")).toBe(
      false
    );
    expect(await isEventEnabled(bob, "request.imported", "webpush")).toBe(true);
  });
});

describe("setPreferences", () => {
  it("updates an existing override rather than inserting a duplicate", async () => {
    const userId = await createUser("alice");

    await setPreferences(userId, [
      { eventId: "request.approved", transportId: "webpush", enabled: false },
    ]);
    await setPreferences(userId, [
      { eventId: "request.approved", transportId: "webpush", enabled: true },
    ]);

    const rows = (await getDataSource().query(
      "SELECT enabled FROM notification_preferences WHERE user_id = ?",
      [userId]
    )) as { enabled: number }[];

    expect(rows).toHaveLength(1);
    expect(await isEventEnabled(userId, "request.approved", "webpush")).toBe(
      true
    );
  });

  it("rejects unknown events", async () => {
    const userId = await createUser("alice");

    await expect(
      setPreferences(userId, [
        {
          eventId: "nope.nope" as never,
          transportId: "webpush",
          enabled: true,
        },
      ])
    ).rejects.toThrow(/Unknown notification event/);
  });

  it("rejects unknown transports", async () => {
    const userId = await createUser("alice");

    await expect(
      setPreferences(userId, [
        {
          eventId: "request.approved",
          transportId: "carrier-pigeon",
          enabled: true,
        },
      ])
    ).rejects.toThrow(/Unknown notification transport/);
  });

  it("writes nothing when one entry in the batch is invalid", async () => {
    const userId = await createUser("alice");

    await expect(
      setPreferences(userId, [
        {
          eventId: "request.approved",
          transportId: "webpush",
          enabled: false,
        },
        { eventId: "request.failed", transportId: "nope", enabled: false },
      ])
    ).rejects.toThrow();

    const rows = (await getDataSource().query(
      "SELECT id FROM notification_preferences WHERE user_id = ?",
      [userId]
    )) as unknown[];
    expect(rows).toHaveLength(0);
  });
});

describe("isEventEnabled", () => {
  it("uses the catalog default when no override exists", async () => {
    const userId = await createUser("alice");

    expect(await isEventEnabled(userId, "request.imported", "webpush")).toBe(
      true
    );
    expect(await isEventEnabled(userId, "request.downloading", "webpush")).toBe(
      false
    );
  });
});

describe("setPreferences batching", () => {
  // Validation runs over the whole batch before any write, so an invalid entry is
  // rejected without touching the DB. The transaction underneath covers the other
  // case: a write failing partway through a valid batch.
  it("rejects an invalid batch without applying its valid entries", async () => {
    const userId = await createUser("carol");
    await setPreferences(userId, [
      { eventId: "request.imported", transportId: "webpush", enabled: false },
    ]);

    await expect(
      setPreferences(userId, [
        { eventId: "request.imported", transportId: "webpush", enabled: true },
        {
          eventId: "not.a.real.event",
          transportId: "webpush",
          enabled: true,
        } as never,
      ])
    ).rejects.toThrow("Unknown notification event");

    // The valid entry in the rejected batch must not have landed.
    expect(await isEventEnabled(userId, "request.imported", "webpush")).toBe(
      false
    );
  });

  it("writes a whole valid batch", async () => {
    const userId = await createUser("dave");

    await setPreferences(userId, [
      { eventId: "request.imported", transportId: "webpush", enabled: false },
      {
        eventId: "request.downloading",
        transportId: "webpush",
        enabled: true,
      },
    ]);

    expect(await isEventEnabled(userId, "request.imported", "webpush")).toBe(
      false
    );
    expect(await isEventEnabled(userId, "request.downloading", "webpush")).toBe(
      true
    );
  });
});
