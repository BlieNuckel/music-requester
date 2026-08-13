import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSendNotification = vi.fn();
const mockListSubscriptions = vi.fn();
const mockDeleteByEndpoint = vi.fn();
const mockHasVapidKeys = vi.fn();

vi.mock("web-push", () => ({
  default: {
    sendNotification: (...args: unknown[]) => mockSendNotification(...args),
    generateVAPIDKeys: () => ({ publicKey: "pub", privateKey: "priv" }),
  },
}));

vi.mock("../../db/pushSubscriptions", () => ({
  listSubscriptions: (...args: unknown[]) => mockListSubscriptions(...args),
  deleteSubscriptionByEndpoint: (...args: unknown[]) =>
    mockDeleteByEndpoint(...args),
}));

vi.mock("./vapid", () => ({
  hasVapidKeys: (...args: unknown[]) => mockHasVapidKeys(...args),
  getWebPushConfig: () => ({
    publicKey: "pub",
    privateKey: "priv",
    subject: "https://example.test",
  }),
}));

import { webPushTransport } from "./webPushTransport";
import type { NotificationMessage } from "./types";

const RECIPIENT = { userId: 1, username: "alice" };

const MESSAGE: NotificationMessage = {
  eventId: "request.imported",
  title: "Ready",
  body: "Your album finished importing.",
  url: "/library/requests",
};

function subscription(endpoint: string) {
  return { endpoint, p256dh: "p256dh", auth: "auth" };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHasVapidKeys.mockReturnValue(true);
  mockSendNotification.mockResolvedValue(undefined);
  mockListSubscriptions.mockResolvedValue([subscription("https://push/a")]);
});

describe("isConfigured", () => {
  it("follows whether VAPID keys exist", () => {
    mockHasVapidKeys.mockReturnValue(false);
    expect(webPushTransport.isConfigured()).toBe(false);

    mockHasVapidKeys.mockReturnValue(true);
    expect(webPushTransport.isConfigured()).toBe(true);
  });
});

describe("send", () => {
  it("delivers the message as a JSON payload with VAPID details", async () => {
    await webPushTransport.send(RECIPIENT, MESSAGE);

    const [target, payload, options] = mockSendNotification.mock.calls[0];
    expect(target).toEqual({
      endpoint: "https://push/a",
      keys: { p256dh: "p256dh", auth: "auth" },
    });
    expect(JSON.parse(payload as string)).toEqual({
      eventId: "request.imported",
      title: "Ready",
      body: "Your album finished importing.",
      url: "/library/requests",
    });
    expect(options).toMatchObject({
      vapidDetails: { publicKey: "pub", privateKey: "priv" },
    });
  });

  it("defaults the deep link to the app root", async () => {
    await webPushTransport.send(RECIPIENT, { ...MESSAGE, url: undefined });

    const payload = JSON.parse(mockSendNotification.mock.calls[0][1] as string);
    expect(payload.url).toBe("/");
  });

  it("sends to every device the user has", async () => {
    mockListSubscriptions.mockResolvedValue([
      subscription("https://push/a"),
      subscription("https://push/b"),
    ]);

    await webPushTransport.send(RECIPIENT, MESSAGE);

    expect(mockSendNotification).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the user has no devices", async () => {
    mockListSubscriptions.mockResolvedValue([]);

    await webPushTransport.send(RECIPIENT, MESSAGE);

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("prunes endpoints the push service reports as gone", async () => {
    mockListSubscriptions.mockResolvedValue([
      subscription("https://push/dead"),
    ]);
    mockSendNotification.mockRejectedValue({ statusCode: 410 });

    await webPushTransport.send(RECIPIENT, MESSAGE);

    expect(mockDeleteByEndpoint).toHaveBeenCalledWith("https://push/dead");
  });

  it("prunes on 404 as well", async () => {
    mockSendNotification.mockRejectedValue({ statusCode: 404 });

    await webPushTransport.send(RECIPIENT, MESSAGE);

    expect(mockDeleteByEndpoint).toHaveBeenCalled();
  });

  it("keeps the subscription on a transient failure", async () => {
    mockSendNotification.mockRejectedValue({ statusCode: 503 });

    await expect(
      webPushTransport.send(RECIPIENT, MESSAGE)
    ).resolves.toBeUndefined();
    expect(mockDeleteByEndpoint).not.toHaveBeenCalled();
  });

  it("isolates one dead device from the rest", async () => {
    mockListSubscriptions.mockResolvedValue([
      subscription("https://push/dead"),
      subscription("https://push/live"),
    ]);
    mockSendNotification
      .mockRejectedValueOnce({ statusCode: 410 })
      .mockResolvedValueOnce(undefined);

    await webPushTransport.send(RECIPIENT, MESSAGE);

    expect(mockSendNotification).toHaveBeenCalledTimes(2);
    expect(mockDeleteByEndpoint).toHaveBeenCalledTimes(1);
  });

  it("truncates a payload that would exceed the push size limit", async () => {
    await webPushTransport.send(RECIPIENT, {
      ...MESSAGE,
      body: "x".repeat(5000),
    });

    const payload = mockSendNotification.mock.calls[0][1] as string;
    expect(payload.length).toBeLessThanOrEqual(3100);
    expect(JSON.parse(payload).body.endsWith("…")).toBe(true);
  });
});
