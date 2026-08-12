import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PushDevicesSection from "../PushDevicesSection";
import type { PushDevice } from "@/pushSubscription";

const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockRevoke = vi.fn();
const mockSendTest = vi.fn();

let mockPwaStatus: {
  isStandalone: boolean;
  platform: "ios" | "android" | "other";
  serviceWorkerSupport: "supported" | "insecure-context" | "unsupported";
  requiresInstallForPush: boolean;
};

let mockDevicesState: {
  devices: PushDevice[];
  loading: boolean;
  error: string | null;
  actionError: string | null;
  busy: boolean;
  permission: "granted" | "denied" | "default" | "unavailable";
  currentEndpoint: string | null;
};

vi.mock("@/hooks/usePwaStatus", () => ({
  default: () => mockPwaStatus,
}));

vi.mock("@/hooks/usePushDevices", () => ({
  default: () => ({
    ...mockDevicesState,
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    revoke: mockRevoke,
    sendTest: mockSendTest,
  }),
}));

const DEVICE: PushDevice = {
  id: 7,
  endpoint: "https://push.example/abc",
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/605",
  createdAt: "2026-08-01T10:00:00.000Z",
  lastSeenAt: "2026-08-10T10:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPwaStatus = {
    isStandalone: true,
    platform: "other",
    serviceWorkerSupport: "supported",
    requiresInstallForPush: false,
  };
  mockDevicesState = {
    devices: [],
    loading: false,
    error: null,
    actionError: null,
    busy: false,
    permission: "default",
    currentEndpoint: null,
  };
});

describe("blocked states", () => {
  it("explains that plain HTTP cannot do push", () => {
    mockPwaStatus.serviceWorkerSupport = "insecure-context";

    render(<PushDevicesSection />);

    expect(screen.getByText(/Push needs a secure connection/)).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("tells iOS users in a tab to install first", () => {
    mockPwaStatus = {
      ...mockPwaStatus,
      platform: "ios",
      isStandalone: false,
      requiresInstallForPush: true,
    };

    render(<PushDevicesSection />);

    expect(screen.getByText(/Add Tunearr to your Home Screen/)).toBeVisible();
  });

  it("explains an unsupported browser", () => {
    mockPwaStatus.serviceWorkerSupport = "unsupported";

    render(<PushDevicesSection />);

    expect(
      screen.getByText(/This browser cannot show notifications/)
    ).toBeVisible();
  });

  it("points at browser settings when permission was denied", () => {
    mockDevicesState.permission = "denied";

    render(<PushDevicesSection />);

    expect(screen.getByText(/Notifications are blocked/)).toBeVisible();
  });
});

describe("subscribe flow", () => {
  it("offers to turn push on for this device", async () => {
    const user = userEvent.setup();
    render(<PushDevicesSection />);

    await user.click(
      screen.getByRole("button", { name: /Turn on for this device/ })
    );

    expect(mockSubscribe).toHaveBeenCalled();
  });

  it("switches to off and test once this device is subscribed", () => {
    mockDevicesState = {
      ...mockDevicesState,
      devices: [DEVICE],
      currentEndpoint: DEVICE.endpoint,
      permission: "granted",
    };

    render(<PushDevicesSection />);

    expect(
      screen.getByRole("button", { name: /Turn off on this device/ })
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Send test notification/ })
    ).toBeVisible();
  });

  it("sends a test notification", async () => {
    const user = userEvent.setup();
    mockDevicesState = {
      ...mockDevicesState,
      devices: [DEVICE],
      currentEndpoint: DEVICE.endpoint,
    };
    render(<PushDevicesSection />);

    await user.click(
      screen.getByRole("button", { name: /Send test notification/ })
    );

    expect(mockSendTest).toHaveBeenCalled();
  });

  it("still offers to subscribe when other devices exist but this one does not", () => {
    mockDevicesState = {
      ...mockDevicesState,
      devices: [DEVICE],
      currentEndpoint: "https://push.example/other",
    };

    render(<PushDevicesSection />);

    expect(
      screen.getByRole("button", { name: /Turn on for this device/ })
    ).toBeVisible();
  });
});

describe("device list", () => {
  it("names each device and marks the current one", () => {
    mockDevicesState = {
      ...mockDevicesState,
      devices: [DEVICE],
      currentEndpoint: DEVICE.endpoint,
    };

    render(<PushDevicesSection />);

    expect(screen.getByText(/Safari on iOS/)).toBeVisible();
    expect(screen.getByText("This device")).toBeVisible();
  });

  it("revokes a device", async () => {
    const user = userEvent.setup();
    mockDevicesState = { ...mockDevicesState, devices: [DEVICE] };
    render(<PushDevicesSection />);

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(mockRevoke).toHaveBeenCalledWith(7);
  });

  it("says so when there are no devices", () => {
    render(<PushDevicesSection />);

    expect(screen.getByText("No devices yet.")).toBeVisible();
  });

  it("disables the controls while an action is running", () => {
    mockDevicesState = { ...mockDevicesState, devices: [DEVICE], busy: true };

    render(<PushDevicesSection />);

    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
  });

  it("shows an action error", () => {
    mockDevicesState = {
      ...mockDevicesState,
      actionError: "Notification permission was not granted",
    };

    render(<PushDevicesSection />);

    expect(
      screen.getByText("Notification permission was not granted")
    ).toBeVisible();
  });
});
