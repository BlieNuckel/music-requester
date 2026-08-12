import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Permission } from "@shared/permissions";
import MyNotificationsSection from "../MyNotificationsSection";
import type { NotificationSettings } from "@/hooks/useNotificationSettings";

const mockSavePreference = vi.fn();

let mockUser: { id: number; permissions: number } | null = {
  id: 1,
  permissions: Permission.REQUEST,
};

let mockState: {
  settings: NotificationSettings | null;
  loading: boolean;
  error: string | null;
  saveError: string | null;
  saving: boolean;
};

vi.mock("@/context/useAuth", () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock("@/hooks/useNotificationSettings", () => ({
  default: () => ({ ...mockState, savePreference: mockSavePreference }),
}));

const USER_EVENT = {
  id: "request.approved" as const,
  label: "Request approved",
  description: "Someone approved a request you made.",
  audience: "user" as const,
  defaultEnabled: true,
};

const ADMIN_EVENT = {
  id: "request.created" as const,
  label: "New request submitted",
  description: "A user submitted a request that needs a decision.",
  audience: "admin" as const,
  defaultEnabled: true,
};

const SETTINGS: NotificationSettings = {
  enabled: true,
  events: [USER_EVENT, ADMIN_EVENT],
  transports: [{ id: "webpush", label: "Web push", configured: true }],
  preferences: [
    { eventId: "request.approved", transportId: "webpush", enabled: true },
    { eventId: "request.created", transportId: "webpush", enabled: false },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = { id: 1, permissions: Permission.REQUEST };
  mockState = {
    settings: SETTINGS,
    loading: false,
    error: null,
    saveError: null,
    saving: false,
  };
});

describe("MyNotificationsSection", () => {
  it("renders a loading state", () => {
    mockState = { ...mockState, loading: true, settings: null };

    render(<MyNotificationsSection />);

    expect(screen.getByText(/Loading notification settings/)).toBeVisible();
  });

  it("renders an error state", () => {
    mockState = { ...mockState, error: "boom", settings: null };

    render(<MyNotificationsSection />);

    expect(screen.getByText("boom")).toBeVisible();
  });

  it("shows user events with a toggle per transport", () => {
    render(<MyNotificationsSection />);

    expect(screen.getByText("Request approved")).toBeVisible();
    expect(
      screen.getByLabelText("Web push", {
        selector: "#request\\.approved-webpush",
      })
    ).toBeChecked();
  });

  it("hides admin events from non-admins", () => {
    render(<MyNotificationsSection />);

    expect(screen.queryByText("New request submitted")).not.toBeInTheDocument();
  });

  it("shows admin events to admins", () => {
    mockUser = { id: 1, permissions: Permission.ADMIN };

    render(<MyNotificationsSection />);

    expect(screen.getByText("New request submitted")).toBeVisible();
  });

  it("saves a preference when a toggle is clicked", async () => {
    const user = userEvent.setup();
    render(<MyNotificationsSection />);

    await user.click(
      screen.getByLabelText("Web push", {
        selector: "#request\\.approved-webpush",
      })
    );

    await waitFor(() =>
      expect(mockSavePreference).toHaveBeenCalledWith({
        eventId: "request.approved",
        transportId: "webpush",
        enabled: false,
      })
    );
  });

  it("explains the empty state when no transport is set up", () => {
    mockState = {
      ...mockState,
      settings: { ...SETTINGS, transports: [] },
    };

    render(<MyNotificationsSection />);

    expect(
      screen.getByText(/No delivery methods are set up yet/)
    ).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("warns when notifications are disabled server-wide", () => {
    mockState = {
      ...mockState,
      settings: { ...SETTINGS, enabled: false },
    };

    render(<MyNotificationsSection />);

    expect(
      screen.getByText(/Notifications are switched off for this server/)
    ).toBeVisible();
  });

  it("shows a save error", () => {
    mockState = { ...mockState, saveError: "Failed to save" };

    render(<MyNotificationsSection />);

    expect(screen.getByText("Failed to save")).toBeVisible();
  });

  it("disables toggles while a save is in flight", () => {
    mockState = { ...mockState, saving: true };

    render(<MyNotificationsSection />);

    expect(
      screen.getByLabelText("Web push", {
        selector: "#request\\.approved-webpush",
      })
    ).toBeDisabled();
  });
});
