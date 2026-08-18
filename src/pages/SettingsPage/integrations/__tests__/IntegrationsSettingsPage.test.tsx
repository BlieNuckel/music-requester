import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { AppSettings } from "@/context/settingsContextDef";

const mockLoadLidarrOptionValues = vi.fn();

const settings: AppSettings = {
  lidarrUrl: "http://lidarr:8686",
  lidarrApiKey: "key",
  lidarrQualityProfileId: 1,
  lidarrRootFolderPath: "/music",
  lidarrMetadataProfileId: 1,
  lastfmApiKey: "fm",
  plexUrl: "",
  importPath: "/import",
  slskdUrl: "",
  slskdApiKey: "",
  slskdDownloadPath: "",
  torznabApiKey: "",
};

let isLoading = false;

vi.mock("@/context/useSettings", () => ({
  useSettings: () => ({
    options: { qualityProfiles: [], metadataProfiles: [], rootFolderPaths: [] },
    settings,
    isConnected: false,
    isLoading,
    saveSettings: vi.fn(),
    savePartialSettings: vi.fn(),
    testConnection: vi.fn(),
    testSlskdConnection: vi.fn(),
    loadLidarrOptionValues: mockLoadLidarrOptionValues,
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

vi.mock("@/context/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", permissions: 1 } }),
}));

import IntegrationsSettingsPage from "../../pages/IntegrationsSettingsPage";
import LidarrIntegrationPage from "../LidarrIntegrationPage";
import LastfmIntegrationPage from "../LastfmIntegrationPage";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/settings/integrations"
          element={<IntegrationsSettingsPage />}
        >
          <Route path="lidarr" element={<LidarrIntegrationPage />} />
          <Route path="lastfm" element={<LastfmIntegrationPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  isLoading = false;
});

describe("IntegrationsSettingsPage", () => {
  it("offers one tab per service instead of one long page", () => {
    renderAt("/settings/integrations/lidarr");

    for (const group of [
      "Lidarr",
      "Soulseek",
      "Plex",
      "Last.fm",
      "Live events",
    ]) {
      expect(
        screen.getAllByRole("link", { name: group }).length
      ).toBeGreaterThan(0);
    }
  });

  it("renders only the active group", () => {
    renderAt("/settings/integrations/lastfm");

    expect(screen.getByDisplayValue("fm")).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("http://lidarr:8686")
    ).not.toBeInTheDocument();
  });

  it("hands the shared fields to the active group", () => {
    renderAt("/settings/integrations/lidarr");

    expect(screen.getByDisplayValue("http://lidarr:8686")).toBeInTheDocument();
    expect(screen.getByDisplayValue("/import")).toBeInTheDocument();
  });

  it("loads the Lidarr option lists once for every group", () => {
    renderAt("/settings/integrations/lastfm");
    expect(mockLoadLidarrOptionValues).toHaveBeenCalled();
  });

  it("shows a skeleton rather than empty groups while settings load", () => {
    isLoading = true;
    renderAt("/settings/integrations/lidarr");

    expect(screen.queryByRole("link", { name: "Lidarr" })).toBeNull();
    expect(screen.queryByDisplayValue("fm")).not.toBeInTheDocument();
  });
});
