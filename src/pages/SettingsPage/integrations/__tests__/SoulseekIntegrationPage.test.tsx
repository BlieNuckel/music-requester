import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

vi.mock("@/context/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", permissions: 1 } }),
}));

vi.mock("@/hooks/useAutoSetupStatus", () => ({
  default: () => ({ status: null, loading: false, refetch: vi.fn() }),
}));

vi.mock("../../shared/AutoSetupModal", () => ({
  default: () => null,
}));

import IntegrationsSettingsPage from "../../pages/IntegrationsSettingsPage";
import SoulseekIntegrationPage from "../SoulseekIntegrationPage";

/** Rendered through the router so the outlet context wiring is exercised too. */
function renderSoulseekGroup() {
  return render(
    <MemoryRouter initialEntries={["/settings/integrations/soulseek"]}>
      <Routes>
        <Route
          path="/settings/integrations"
          element={<IntegrationsSettingsPage />}
        >
          <Route path="soulseek" element={<SoulseekIntegrationPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SoulseekIntegrationPage", () => {
  it("receives the shared settings through the outlet", () => {
    renderSoulseekGroup();
    expect(screen.getByDisplayValue("http://slskd:5030")).toBeInTheDocument();
  });

  it("shows a success banner with version and soulseek state", async () => {
    mockTestSlskdConnection.mockResolvedValue({
      success: true,
      version: "0.21.0",
      soulseekConnected: true,
    });

    renderSoulseekGroup();
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));

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

    renderSoulseekGroup();
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));

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

    renderSoulseekGroup();
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));

    await waitFor(() =>
      expect(
        screen.getByText(/Connection failed: slskd returned 401/)
      ).toBeInTheDocument()
    );
  });

  it("reports a thrown test rather than leaving the button spinning", async () => {
    mockTestSlskdConnection.mockRejectedValue(new Error("network down"));

    renderSoulseekGroup();
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));

    await waitFor(() =>
      expect(
        screen.getByText(/Connection failed: network down/)
      ).toBeInTheDocument()
    );
  });
});
