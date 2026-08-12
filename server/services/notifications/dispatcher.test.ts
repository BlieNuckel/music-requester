import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUserById = vi.fn();
const mockGetAllUsers = vi.fn();
const mockGetConfigValue = vi.fn();
const mockIsEventEnabled = vi.fn();

vi.mock("../../auth/users", () => ({
  findUserById: (...args: unknown[]) => mockFindUserById(...args),
  getAllUsers: (...args: unknown[]) => mockGetAllUsers(...args),
}));

vi.mock("../../config", () => ({
  getConfigValue: (...args: unknown[]) => mockGetConfigValue(...args),
}));

vi.mock("./preferences", () => ({
  isEventEnabled: (...args: unknown[]) => mockIsEventEnabled(...args),
}));

import { Permission } from "../../../shared/permissions";
import { notifyAdmins, notifyUser } from "./dispatcher";
import { clearTransports, registerTransport } from "./registry";
import type { NotificationMessage, NotificationTransport } from "./types";

const USER_MESSAGE: NotificationMessage = {
  eventId: "request.imported",
  title: "Ready",
  body: "Your album finished importing.",
};

const ADMIN_MESSAGE: NotificationMessage = {
  eventId: "request.created",
  title: "New request",
  body: "Someone requested an album.",
};

function makeTransport(
  id: string,
  send: NotificationTransport["send"],
  overrides: Partial<NotificationTransport> = {}
): NotificationTransport {
  return {
    id,
    label: id,
    isConfigured: () => true,
    send,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearTransports();
  mockGetConfigValue.mockReturnValue({ enabled: true });
  mockIsEventEnabled.mockResolvedValue(true);
  mockFindUserById.mockResolvedValue({
    id: 1,
    username: "alice",
    enabled: true,
    permissions: Permission.REQUEST,
  });
});

describe("notifyUser", () => {
  it("sends through every configured transport", async () => {
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);
    registerTransport(makeTransport("a", first));
    registerTransport(makeTransport("b", second));

    await notifyUser(1, USER_MESSAGE);

    expect(first).toHaveBeenCalledWith(
      { userId: 1, username: "alice" },
      USER_MESSAGE
    );
    expect(second).toHaveBeenCalledOnce();
  });

  it("skips transports the user disabled for that event", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    registerTransport(makeTransport("a", send));
    mockIsEventEnabled.mockResolvedValue(false);

    await notifyUser(1, USER_MESSAGE);

    expect(send).not.toHaveBeenCalled();
  });

  it("sends through internal transports regardless of preferences", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    registerTransport(makeTransport("log", send, { internal: true }));
    mockIsEventEnabled.mockResolvedValue(false);

    await notifyUser(1, USER_MESSAGE);

    expect(send).toHaveBeenCalledOnce();
    expect(mockIsEventEnabled).not.toHaveBeenCalled();
  });

  it("skips transports that are not configured", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    registerTransport(makeTransport("a", send, { isConfigured: () => false }));

    await notifyUser(1, USER_MESSAGE);

    expect(send).not.toHaveBeenCalled();
  });

  it("isolates a failing transport from the others", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("smtp is down"));
    const working = vi.fn().mockResolvedValue(undefined);
    registerTransport(makeTransport("a", failing));
    registerTransport(makeTransport("b", working));

    await expect(notifyUser(1, USER_MESSAGE)).resolves.toBeUndefined();
    expect(working).toHaveBeenCalledOnce();
  });

  it("does nothing when notifications are disabled in config", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    registerTransport(makeTransport("a", send));
    mockGetConfigValue.mockReturnValue({ enabled: false });

    await notifyUser(1, USER_MESSAGE);

    expect(send).not.toHaveBeenCalled();
  });

  it("does nothing for an unknown or disabled user", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    registerTransport(makeTransport("a", send));

    mockFindUserById.mockResolvedValue(null);
    await notifyUser(1, USER_MESSAGE);

    mockFindUserById.mockResolvedValue({
      id: 1,
      username: "alice",
      enabled: false,
      permissions: Permission.REQUEST,
    });
    await notifyUser(1, USER_MESSAGE);

    expect(send).not.toHaveBeenCalled();
  });

  it("refuses to route an admin event to a single user", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    registerTransport(makeTransport("a", send));

    await notifyUser(1, ADMIN_MESSAGE);

    expect(send).not.toHaveBeenCalled();
  });
});

describe("notifyAdmins", () => {
  beforeEach(() => {
    mockGetAllUsers.mockResolvedValue([
      {
        id: 1,
        username: "admin",
        enabled: true,
        permissions: Permission.ADMIN,
      },
      {
        id: 2,
        username: "user",
        enabled: true,
        permissions: Permission.REQUEST,
      },
      {
        id: 3,
        username: "disabled-admin",
        enabled: false,
        permissions: Permission.ADMIN,
      },
    ]);
  });

  it("sends only to enabled admins", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    registerTransport(makeTransport("a", send));

    await notifyAdmins(ADMIN_MESSAGE);

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      { userId: 1, username: "admin" },
      ADMIN_MESSAGE
    );
  });

  it("refuses to broadcast a user event", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    registerTransport(makeTransport("a", send));

    await notifyAdmins(USER_MESSAGE);

    expect(send).not.toHaveBeenCalled();
  });

  it("does nothing when no admin is enabled", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    registerTransport(makeTransport("a", send));
    mockGetAllUsers.mockResolvedValue([
      {
        id: 2,
        username: "user",
        enabled: true,
        permissions: Permission.REQUEST,
      },
    ]);

    await notifyAdmins(ADMIN_MESSAGE);

    expect(send).not.toHaveBeenCalled();
  });
});
