import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetConfigValue = vi.fn();
const mockSetConfig = vi.fn();
const mockGenerateKeys = vi.fn();

vi.mock("../../config", () => ({
  getConfigValue: (...args: unknown[]) => mockGetConfigValue(...args),
  setConfig: (...args: unknown[]) => mockSetConfig(...args),
}));

vi.mock("web-push", () => ({
  default: {
    generateVAPIDKeys: (...args: unknown[]) => mockGenerateKeys(...args),
  },
}));

import { ensureVapidKeys, hasVapidKeys } from "./vapid";

function withKeys(publicKey: string, privateKey: string) {
  mockGetConfigValue.mockReturnValue({
    enabled: true,
    webPush: { publicKey, privateKey, subject: "https://example.test" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateKeys.mockReturnValue({
    publicKey: "generated-pub",
    privateKey: "generated-priv",
  });
});

describe("hasVapidKeys", () => {
  it("is false until both keys exist", () => {
    withKeys("", "");
    expect(hasVapidKeys()).toBe(false);

    withKeys("pub", "");
    expect(hasVapidKeys()).toBe(false);

    withKeys("pub", "priv");
    expect(hasVapidKeys()).toBe(true);
  });
});

describe("ensureVapidKeys", () => {
  it("generates and persists a keypair on first boot", () => {
    withKeys("", "");

    ensureVapidKeys();

    expect(mockGenerateKeys).toHaveBeenCalledOnce();
    expect(mockSetConfig).toHaveBeenCalledWith({
      notifications: {
        webPush: {
          publicKey: "generated-pub",
          privateKey: "generated-priv",
        },
      },
    });
  });

  it("never rotates an existing keypair", () => {
    withKeys("pub", "priv");

    ensureVapidKeys();

    expect(mockGenerateKeys).not.toHaveBeenCalled();
    expect(mockSetConfig).not.toHaveBeenCalled();
  });
});
