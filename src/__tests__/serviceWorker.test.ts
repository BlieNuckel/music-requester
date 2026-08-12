import {
  getServiceWorkerSupport,
  registerServiceWorker,
} from "../serviceWorker";

const mockRegister = vi.fn();
const mockUpdate = vi.fn();

function setSecureContext(value: boolean) {
  Object.defineProperty(window, "isSecureContext", {
    value,
    configurable: true,
  });
}

function setServiceWorker(available: boolean) {
  if (available) {
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register: mockRegister },
      configurable: true,
    });
    return;
  }
  Reflect.deleteProperty(navigator, "serviceWorker");
}

beforeEach(() => {
  vi.clearAllMocks();
  setSecureContext(true);
  setServiceWorker(true);
  mockRegister.mockResolvedValue({ update: mockUpdate });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("getServiceWorkerSupport", () => {
  it("reports supported in a secure context with the API present", () => {
    expect(getServiceWorkerSupport()).toBe("supported");
  });

  it("reports insecure-context over plain HTTP", () => {
    setSecureContext(false);

    expect(getServiceWorkerSupport()).toBe("insecure-context");
  });

  it("reports unsupported when the API is missing in a secure context", () => {
    setServiceWorker(false);

    expect(getServiceWorkerSupport()).toBe("unsupported");
  });
});

describe("registerServiceWorker", () => {
  it("registers the worker at the app root", async () => {
    const registration = await registerServiceWorker();

    expect(mockRegister).toHaveBeenCalledWith("/sw.js");
    expect(registration).not.toBeNull();
  });

  it("no-ops in an insecure context", async () => {
    setSecureContext(false);

    await expect(registerServiceWorker()).resolves.toBeNull();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("no-ops when service workers are unavailable", async () => {
    setServiceWorker(false);

    await expect(registerServiceWorker()).resolves.toBeNull();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("resolves to null instead of throwing when registration fails", async () => {
    mockRegister.mockRejectedValue(new Error("nope"));

    await expect(registerServiceWorker()).resolves.toBeNull();
  });

  it("checks for a new worker when the page becomes visible", async () => {
    await registerServiceWorker();

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(mockUpdate).toHaveBeenCalled();
  });

  it("ignores a failing update check", async () => {
    mockUpdate.mockRejectedValue(new Error("offline"));
    await registerServiceWorker();

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });

    expect(() =>
      document.dispatchEvent(new Event("visibilitychange"))
    ).not.toThrow();
  });
});
