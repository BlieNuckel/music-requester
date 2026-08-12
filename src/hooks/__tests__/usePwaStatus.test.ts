import { renderHook, act } from "@testing-library/react";
import usePwaStatus from "../usePwaStatus";

type MediaQueryStub = {
  matches: boolean;
  addEventListener: (
    type: string,
    listener: (e: MediaQueryListEvent) => void
  ) => void;
  removeEventListener: (
    type: string,
    listener: (e: MediaQueryListEvent) => void
  ) => void;
};

let listeners: ((e: MediaQueryListEvent) => void)[] = [];

function stubMatchMedia(matches: boolean) {
  const query: MediaQueryStub = {
    matches,
    addEventListener: (_type, listener) => listeners.push(listener),
    removeEventListener: (_type, listener) => {
      listeners = listeners.filter((l) => l !== listener);
    },
  };
  vi.stubGlobal("matchMedia", () => query);
}

function stubNavigator(
  userAgent: string,
  extras: { standalone?: boolean; maxTouchPoints?: number } = {}
) {
  Object.defineProperty(navigator, "userAgent", {
    value: userAgent,
    configurable: true,
  });
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: extras.maxTouchPoints ?? 0,
    configurable: true,
  });
  if (extras.standalone !== undefined) {
    Object.defineProperty(navigator, "standalone", {
      value: extras.standalone,
      configurable: true,
    });
  } else {
    Reflect.deleteProperty(navigator, "standalone");
  }
}

beforeEach(() => {
  listeners = [];
  stubMatchMedia(false);
  stubNavigator("Mozilla/5.0 (Macintosh)");
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(navigator, "serviceWorker", {
    value: { register: vi.fn() },
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("usePwaStatus", () => {
  it("detects a browser tab as not standalone", () => {
    const { result } = renderHook(() => usePwaStatus());

    expect(result.current.isStandalone).toBe(false);
  });

  it("detects standalone display mode", () => {
    stubMatchMedia(true);

    const { result } = renderHook(() => usePwaStatus());

    expect(result.current.isStandalone).toBe(true);
  });

  it("detects an iOS home-screen install via navigator.standalone", () => {
    stubNavigator("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", {
      standalone: true,
    });

    const { result } = renderHook(() => usePwaStatus());

    expect(result.current.isStandalone).toBe(true);
    expect(result.current.platform).toBe("ios");
  });

  it("identifies Android", () => {
    stubNavigator("Mozilla/5.0 (Linux; Android 14)");

    expect(renderHook(() => usePwaStatus()).result.current.platform).toBe(
      "android"
    );
  });

  it("identifies iPadOS despite its desktop user agent", () => {
    stubNavigator("Mozilla/5.0 (Macintosh; Intel Mac OS X)", {
      maxTouchPoints: 5,
    });

    expect(renderHook(() => usePwaStatus()).result.current.platform).toBe(
      "ios"
    );
  });

  it("falls back to other on desktop", () => {
    expect(renderHook(() => usePwaStatus()).result.current.platform).toBe(
      "other"
    );
  });

  it("requires an install before push on iOS in a tab", () => {
    stubNavigator("Mozilla/5.0 (iPhone)");

    const { result } = renderHook(() => usePwaStatus());

    expect(result.current.requiresInstallForPush).toBe(true);
  });

  it("does not require an install once iOS runs standalone", () => {
    stubNavigator("Mozilla/5.0 (iPhone)", { standalone: true });

    const { result } = renderHook(() => usePwaStatus());

    expect(result.current.requiresInstallForPush).toBe(false);
  });

  it("never requires an install on Android", () => {
    stubNavigator("Mozilla/5.0 (Linux; Android 14)");

    expect(
      renderHook(() => usePwaStatus()).result.current.requiresInstallForPush
    ).toBe(false);
  });

  it("reports service worker support", () => {
    const { result } = renderHook(() => usePwaStatus());

    expect(result.current.serviceWorkerSupport).toBe("supported");
  });

  it("reacts to display-mode changes", () => {
    const { result } = renderHook(() => usePwaStatus());
    expect(result.current.isStandalone).toBe(false);

    act(() => {
      listeners.forEach((listener) =>
        listener({ matches: true } as MediaQueryListEvent)
      );
    });

    expect(result.current.isStandalone).toBe(true);
  });
});
