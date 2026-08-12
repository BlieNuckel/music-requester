import {
  getCurrentEndpoint,
  getPushPermission,
  subscribeToPush,
  unsubscribeFromPush,
  urlBase64ToUint8Array,
} from "../pushSubscription";

const mockFetch = vi.fn();
const mockSubscribe = vi.fn();
const mockGetSubscription = vi.fn();
const mockRequestPermission = vi.fn();
const mockUnsubscribe = vi.fn();

const SUBSCRIPTION = {
  endpoint: "https://push.example/abc",
  toJSON: () => ({
    endpoint: "https://push.example/abc",
    keys: { p256dh: "p", auth: "a" },
  }),
  unsubscribe: () => mockUnsubscribe(),
};

function stubServiceWorker() {
  Object.defineProperty(navigator, "serviceWorker", {
    value: {
      ready: Promise.resolve({
        pushManager: {
          subscribe: mockSubscribe,
          getSubscription: mockGetSubscription,
        },
      }),
    },
    configurable: true,
  });
}

function stubNotification(permission: string) {
  vi.stubGlobal("Notification", {
    permission,
    requestPermission: mockRequestPermission,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  stubServiceWorker();
  stubNotification("default");
  mockRequestPermission.mockResolvedValue("granted");
  mockGetSubscription.mockResolvedValue(null);
  mockSubscribe.mockResolvedValue(SUBSCRIPTION);
  mockFetch.mockImplementation((url: string) => {
    if (url.endsWith("/webpush/key")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ publicKey: "dGVzdC1rZXk" }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url, padding included", () => {
    expect(Array.from(urlBase64ToUint8Array("YWJj"))).toEqual([97, 98, 99]);
    expect(urlBase64ToUint8Array("YQ").length).toBe(1);
  });

  it("translates the url-safe alphabet", () => {
    const decoded = urlBase64ToUint8Array("-_8");
    expect(Array.from(decoded)).toEqual([251, 255]);
  });
});

describe("getPushPermission", () => {
  it("reports unavailable when the API is missing", () => {
    vi.stubGlobal("Notification", undefined);

    expect(getPushPermission()).toBe("unavailable");
  });

  it("passes the browser permission through", () => {
    stubNotification("granted");

    expect(getPushPermission()).toBe("granted");
  });
});

describe("subscribeToPush", () => {
  it("asks for permission, subscribes, and posts the subscription", async () => {
    await subscribeToPush();

    expect(mockRequestPermission).toHaveBeenCalled();
    expect(mockSubscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true })
    );
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/notifications/webpush/subscribe",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws when permission is refused, without subscribing", async () => {
    mockRequestPermission.mockResolvedValue("denied");

    await expect(subscribeToPush()).rejects.toThrow(/permission/i);
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it("reuses an existing browser subscription", async () => {
    mockGetSubscription.mockResolvedValue(SUBSCRIPTION);

    await subscribeToPush();

    expect(mockSubscribe).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/notifications/webpush/subscribe",
      expect.anything()
    );
  });

  it("fails clearly when the server has no push key", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ publicKey: "" }),
    });

    await expect(subscribeToPush()).rejects.toThrow(/no push key/i);
  });

  it("surfaces a server rejection of the subscription", async () => {
    mockFetch.mockImplementation((url: string) =>
      url.endsWith("/webpush/key")
        ? Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ publicKey: "dGVzdC1rZXk" }),
          })
        : Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ error: "endpoint is required" }),
          })
    );

    await expect(subscribeToPush()).rejects.toThrow("endpoint is required");
  });
});

describe("unsubscribeFromPush", () => {
  it("tells the server and then drops the browser subscription", async () => {
    mockGetSubscription.mockResolvedValue(SUBSCRIPTION);

    await unsubscribeFromPush();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/notifications/webpush/unsubscribe",
      expect.objectContaining({ method: "POST" })
    );
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it("does nothing when this browser is not subscribed", async () => {
    await unsubscribeFromPush();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockUnsubscribe).not.toHaveBeenCalled();
  });
});

describe("getCurrentEndpoint", () => {
  it("returns the endpoint of this browser's subscription", async () => {
    mockGetSubscription.mockResolvedValue(SUBSCRIPTION);

    expect(await getCurrentEndpoint()).toBe("https://push.example/abc");
  });

  it("returns null without a subscription", async () => {
    expect(await getCurrentEndpoint()).toBeNull();
  });

  it("returns null when service workers are unavailable", async () => {
    Reflect.deleteProperty(navigator, "serviceWorker");

    expect(await getCurrentEndpoint()).toBeNull();
  });
});
