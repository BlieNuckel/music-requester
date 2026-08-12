import SW_SOURCE from "../../public/sw.js?raw";

type Handler = (event: Record<string, unknown>) => void;

type FakeSelf = {
  addEventListener: (type: string, handler: Handler) => void;
  skipWaiting: ReturnType<typeof vi.fn>;
  location: { origin: string };
  registration: { showNotification: ReturnType<typeof vi.fn> };
  clients: {
    claim: ReturnType<typeof vi.fn>;
    matchAll: ReturnType<typeof vi.fn>;
    openWindow: ReturnType<typeof vi.fn>;
  };
};

let handlers: Record<string, Handler>;
let fakeSelf: FakeSelf;
let waited: Promise<unknown>[];

function loadServiceWorker() {
  handlers = {};
  waited = [];
  fakeSelf = {
    addEventListener: (type, handler) => {
      handlers[type] = handler;
    },
    skipWaiting: vi.fn(),
    location: { origin: "https://tunearr.test" },
    registration: { showNotification: vi.fn().mockResolvedValue(undefined) },
    clients: {
      claim: vi.fn().mockResolvedValue(undefined),
      matchAll: vi.fn().mockResolvedValue([]),
      openWindow: vi.fn().mockResolvedValue(undefined),
    },
  };

  new Function("self", SW_SOURCE)(fakeSelf);
}

function waitUntil(promise: Promise<unknown>) {
  waited.push(promise);
}

async function settle() {
  await Promise.all(waited);
}

beforeEach(() => {
  loadServiceWorker();
});

describe("lifecycle", () => {
  it("takes over immediately on install", () => {
    handlers.install({});

    expect(fakeSelf.skipWaiting).toHaveBeenCalled();
  });

  it("claims open clients on activate", () => {
    handlers.activate({ waitUntil });

    expect(fakeSelf.clients.claim).toHaveBeenCalled();
  });
});

describe("push", () => {
  it("renders a notification from a JSON payload", async () => {
    handlers.push({
      waitUntil,
      data: {
        json: () => ({
          eventId: "request.imported",
          title: "Ready",
          body: "Your album finished importing.",
          url: "/library/requests",
        }),
      },
    });
    await settle();

    expect(fakeSelf.registration.showNotification).toHaveBeenCalledWith(
      "Ready",
      expect.objectContaining({
        body: "Your album finished importing.",
        tag: "request.imported",
        data: { url: "/library/requests" },
      })
    );
  });

  it("falls back to plain text when the payload is not JSON", async () => {
    handlers.push({
      waitUntil,
      data: {
        json: () => {
          throw new Error("not json");
        },
        text: () => "hello",
      },
    });
    await settle();

    expect(fakeSelf.registration.showNotification).toHaveBeenCalledWith(
      "Tunearr",
      expect.objectContaining({ body: "hello" })
    );
  });

  it("renders a default notification when there is no payload", async () => {
    handlers.push({ waitUntil });
    await settle();

    expect(fakeSelf.registration.showNotification).toHaveBeenCalledWith(
      "Tunearr",
      expect.objectContaining({ body: "", data: { url: "/" } })
    );
  });
});

describe("notificationclick", () => {
  it("opens a new window when nothing is open", async () => {
    const close = vi.fn();

    handlers.notificationclick({
      waitUntil,
      notification: { close, data: { url: "/album/abc" } },
    });
    await settle();

    expect(close).toHaveBeenCalled();
    expect(fakeSelf.clients.openWindow).toHaveBeenCalledWith("/album/abc");
  });

  it("focuses and navigates an existing window", async () => {
    const focus = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn().mockResolvedValue(undefined);
    fakeSelf.clients.matchAll.mockResolvedValue([
      { url: "https://tunearr.test/", focus, navigate },
    ]);

    handlers.notificationclick({
      waitUntil,
      notification: { close: vi.fn(), data: { url: "/album/abc" } },
    });
    await settle();

    expect(focus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/album/abc");
    expect(fakeSelf.clients.openWindow).not.toHaveBeenCalled();
  });

  it("defaults to the app root when the notification carries no url", async () => {
    handlers.notificationclick({
      waitUntil,
      notification: { close: vi.fn(), data: undefined },
    });
    await settle();

    expect(fakeSelf.clients.openWindow).toHaveBeenCalledWith("/");
  });
});
