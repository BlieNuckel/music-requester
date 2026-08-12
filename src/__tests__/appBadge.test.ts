import { syncAppBadge } from "../appBadge";

const mockSetAppBadge = vi.fn();
const mockClearAppBadge = vi.fn();

function stubBadging(available: boolean) {
  if (!available) {
    Reflect.deleteProperty(navigator, "setAppBadge");
    Reflect.deleteProperty(navigator, "clearAppBadge");
    return;
  }
  Object.defineProperty(navigator, "setAppBadge", {
    value: mockSetAppBadge,
    configurable: true,
  });
  Object.defineProperty(navigator, "clearAppBadge", {
    value: mockClearAppBadge,
    configurable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSetAppBadge.mockResolvedValue(undefined);
  mockClearAppBadge.mockResolvedValue(undefined);
  stubBadging(true);
});

afterEach(() => {
  stubBadging(false);
});

describe("syncAppBadge", () => {
  it("sets the badge to the unseen count", () => {
    syncAppBadge(3);

    expect(mockSetAppBadge).toHaveBeenCalledWith(3);
    expect(mockClearAppBadge).not.toHaveBeenCalled();
  });

  it("clears the badge at zero", () => {
    syncAppBadge(0);

    expect(mockClearAppBadge).toHaveBeenCalled();
    expect(mockSetAppBadge).not.toHaveBeenCalled();
  });

  it("does nothing where badging is unsupported", () => {
    stubBadging(false);

    expect(() => syncAppBadge(2)).not.toThrow();
  });

  it("swallows a rejected badge update", async () => {
    mockSetAppBadge.mockRejectedValue(new Error("not installed"));

    expect(() => syncAppBadge(2)).not.toThrow();
    await Promise.resolve();
  });
});
