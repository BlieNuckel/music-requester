import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import RequireOnboarding from "../RequireOnboarding";
import {
  SettingsContext,
  type SettingsContextValue,
} from "@/context/settingsContextDef";
import {
  AuthContext,
  type AuthContextValue,
  type AuthStatus,
} from "@/context/authContextDef";
import { Permission } from "@shared/permissions";

function makeAuthValue(permissions: number): AuthContextValue {
  return {
    status: "authenticated" as AuthStatus,
    user: {
      id: 1,
      username: "testuser",
      userType: "local",
      permissions,
      theme: "system",
      thumb: null,
      hasPlexToken: false,
    },
    login: vi.fn(),
    plexLogin: vi.fn(),
    plexSetup: vi.fn(),
    linkPlex: vi.fn(),
    logout: vi.fn(),
    setup: vi.fn(),
    updatePreferences: vi.fn(),
    refreshUser: vi.fn(),
  };
}

const emptySettings = {
  lidarrUrl: "",
  lidarrApiKey: "",
  lidarrQualityProfileId: 1,
  lidarrRootFolderPath: "",
  lidarrMetadataProfileId: 1,
  lastfmApiKey: "",
  plexUrl: "",
  importPath: "",
  slskdUrl: "",
  slskdApiKey: "",
  slskdDownloadPath: "",
};

function renderWithContext(
  contextValue: Partial<SettingsContextValue>,
  permissions = Permission.ADMIN
) {
  const defaultValue: SettingsContextValue = {
    options: { qualityProfiles: [], metadataProfiles: [], rootFolderPaths: [] },
    settings: emptySettings,
    isConnected: false,
    isLoading: false,
    loadError: null,
    saveSettings: vi.fn(),
    savePartialSettings: vi.fn(),
    testConnection: vi.fn(),
    testSlskdConnection: vi.fn(),
    loadLidarrOptionValues: vi.fn(),
    ...contextValue,
  };

  return render(
    <AuthContext.Provider value={makeAuthValue(permissions)}>
      <SettingsContext.Provider value={defaultValue}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route element={<RequireOnboarding />}>
              <Route path="/" element={<div>Main App</div>} />
            </Route>
            <Route path="/onboarding" element={<div>Onboarding</div>} />
          </Routes>
        </MemoryRouter>
      </SettingsContext.Provider>
    </AuthContext.Provider>
  );
}

describe("RequireOnboarding", () => {
  it("renders nothing while loading", () => {
    const { container } = renderWithContext({ isLoading: true });
    expect(container.textContent).toBe("");
  });

  it("redirects admin to /onboarding when lidarrUrl is empty", () => {
    renderWithContext({ isLoading: false }, Permission.ADMIN);
    expect(screen.getByText("Onboarding")).toBeInTheDocument();
  });

  it("shows awaiting setup page for non-admin when lidarrUrl is empty", () => {
    renderWithContext({ isLoading: false }, Permission.REQUEST);
    expect(screen.getByText("Not Yet Configured")).toBeInTheDocument();
    expect(screen.getByText(/contact your administrator/)).toBeInTheDocument();
  });

  it("renders outlet when lidarrUrl is configured", () => {
    renderWithContext({
      isLoading: false,
      settings: { ...emptySettings, lidarrUrl: "http://lidarr:8686" },
    });
    expect(screen.getByText("Main App")).toBeInTheDocument();
  });
});
