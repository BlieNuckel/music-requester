import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AppSettings } from "@/context/settingsContextDef";

const mockTestSlskdConnection = vi.fn();

const settings: AppSettings = {
  lidarrUrl: "",
  lidarrApiKey: "",
  lidarrQualityProfileId: 1,
  lidarrRootFolderPath: "",
  lidarrMetadataProfileId: 1,
  lastfmApiKey: "",
  plexUrl: "",
  importPath: "",
  slskdUrl: "http://slskd:5030",
  slskdApiKey: "key",
  slskdDownloadPath: "/downloads",
  torznabApiKey: "",
};

vi.mock("@/context/useSettings", () => ({
  useSettings: () => ({
    options: { qualityProfiles: [], metadataProfiles: [], rootFolderPaths: [] },
    settings,
    isConnected: false,
    isLoading: false,
    saveSettings: vi.fn(),
    savePartialSettings: vi.fn(),
    testConnection: vi.fn(),
    testSlskdConnection: mockTestSlskdConnection,
    loadLidarrOptionValues: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAutoSave", () => ({
  useAutoSave: () => ({
    fields: settings,
    saveStatus: "idle",
    saveError: null,
    updateField: vi.fn(),
    updateFields: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAutoSetupStatus", () => ({
  default: () => ({ status: null, loading: false, refetch: vi.fn() }),
}));

vi.mock("../../shared/AutoSetupModal", () => ({
  default: () => null,
}));

vi.mock("../../sections/integrations/PlexSection", () => ({
  default: () => null,
}));

import IntegrationsSettingsPage from "../IntegrationsSettingsPage";

function getSlskdTestButton() {
  const buttons = screen.getAllByRole("button", { name: "Test Connection" });
  return buttons[buttons.length - 1];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("IntegrationsSettingsPage slskd test connection", () => {
  it("shows a success banner with version and soulseek state", async () => {
    mockTestSlskdConnection.mockResolvedValue({
      success: true,
      version: "0.21.0",
      soulseekConnected: true,
    });

    render(<IntegrationsSettingsPage />);
    fireEvent.click(getSlskdTestButton());

    await waitFor(() =>
      expect(
        screen.getByText(/Connected! slskd v0\.21\.0 is logged into Soulseek/)
      ).toBeInTheDocument()
    );
    expect(mockTestSlskdConnection).toHaveBeenCalledWith(settings);
  });

  it("warns when slskd is reachable but not logged into Soulseek", async () => {
    mockTestSlskdConnection.mockResolvedValue({
      success: true,
      version: "0.21.0",
      soulseekConnected: false,
    });

    render(<IntegrationsSettingsPage />);
    fireEvent.click(getSlskdTestButton());

    await waitFor(() =>
      expect(
        screen.getByText(/not logged into the Soulseek network/)
      ).toBeInTheDocument()
    );
  });

  it("shows a failure banner when the connection fails", async () => {
    mockTestSlskdConnection.mockResolvedValue({
      success: false,
      error: "slskd returned 401",
    });

    render(<IntegrationsSettingsPage />);
    fireEvent.click(getSlskdTestButton());

    await waitFor(() =>
      expect(
        screen.getByText(/Connection failed: slskd returned 401/)
      ).toBeInTheDocument()
    );
  });
});
