import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@/hooks/usePlexLogin", () => ({
  default: () => ({ loading: false, login: vi.fn() }),
  fetchAccount: () => Promise.resolve(null),
  pickBestServer: (servers: { local: boolean }[]) =>
    servers.find((s) => !s.local) ?? servers[0],
}));

vi.mock("@/utils/plexOAuth", () => ({
  getClientId: () => "test-client-id",
}));

vi.mock("@/context/useAuth", () => ({
  useAuth: () => ({
    user: { hasPlexToken: false },
    status: "authenticated",
    refreshUser: vi.fn(),
  }),
}));

import OnboardingPage from "../OnboardingPage";
import {
  SettingsContext,
  type SettingsContextValue,
} from "@/context/settingsContextDef";

const mockTestConnection = vi.fn();
const mockSaveSettings = vi.fn();
const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

function renderOnboarding(overrides: Partial<SettingsContextValue> = {}) {
  const defaultContext: SettingsContextValue = {
    options: { qualityProfiles: [], metadataProfiles: [], rootFolderPaths: [] },
    settings: {
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
    },
    isConnected: false,
    isLoading: false,
    loadError: null,
    saveSettings: mockSaveSettings,
    savePartialSettings: vi.fn(),
    testConnection: mockTestConnection,
    testSlskdConnection: vi.fn(),
    loadLidarrOptionValues: vi.fn(),
    ...overrides,
  };

  return render(
    <SettingsContext.Provider value={defaultContext}>
      <MemoryRouter initialEntries={["/onboarding"]}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/" element={<div>Home Page</div>} />
        </Routes>
      </MemoryRouter>
    </SettingsContext.Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OnboardingPage", () => {
  it("renders wizard while settings are loading", () => {
    renderOnboarding({ isLoading: true });
    expect(screen.getByText("Welcome to Tunearr")).toBeInTheDocument();
  });

  it("does not redirect while settings are still loading even if url exists", () => {
    renderOnboarding({
      isLoading: true,
      settings: {
        lidarrUrl: "http://lidarr:8686",
        lidarrApiKey: "key",
        lidarrQualityProfileId: 1,
        lidarrRootFolderPath: "/music",
        lidarrMetadataProfileId: 1,
        lastfmApiKey: "",
        plexUrl: "",
        importPath: "",
        slskdUrl: "",
        slskdApiKey: "",
        slskdDownloadPath: "",
      },
    });
    expect(screen.getByText("Welcome to Tunearr")).toBeInTheDocument();
  });

  it("redirects to home if already configured", () => {
    renderOnboarding({
      settings: {
        lidarrUrl: "http://lidarr:8686",
        lidarrApiKey: "key",
        lidarrQualityProfileId: 1,
        lidarrRootFolderPath: "/music",
        lidarrMetadataProfileId: 1,
        lastfmApiKey: "",
        plexUrl: "",
        importPath: "",
        slskdUrl: "",
        slskdApiKey: "",
        slskdDownloadPath: "",
      },
    });
    expect(screen.getByText("Home Page")).toBeInTheDocument();
  });

  it("shows welcome step initially", () => {
    renderOnboarding();
    expect(screen.getByText("Welcome to Tunearr")).toBeInTheDocument();
    expect(screen.getByText("Get Started")).toBeInTheDocument();
  });

  it("navigates from welcome to lidarr connection", () => {
    renderOnboarding();
    fireEvent.click(screen.getByText("Get Started"));
    expect(screen.getByText("Lidarr Connection")).toBeInTheDocument();
    expect(screen.getByTestId("lidarr-url-input")).toBeInTheDocument();
  });

  it("tests connection and advances to options step", async () => {
    mockTestConnection.mockResolvedValue({
      success: true,
      version: "2.0.0",
      qualityProfiles: [{ id: 1, name: "Any" }],
      metadataProfiles: [{ id: 1, name: "Standard" }],
      rootFolderPaths: [{ id: 1, path: "/music" }],
    });

    renderOnboarding();
    fireEvent.click(screen.getByText("Get Started"));

    fireEvent.change(screen.getByTestId("lidarr-url-input"), {
      target: { value: "http://lidarr:8686" },
    });
    fireEvent.change(screen.getByTestId("lidarr-apikey-input"), {
      target: { value: "testkey" },
    });
    fireEvent.click(screen.getByText("Test Connection"));

    await waitFor(() => {
      expect(screen.getByText("Connected! Lidarr v2.0.0")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Lidarr Options")).toBeInTheDocument();
  });

  it("shows optional steps with skip button", async () => {
    mockTestConnection.mockResolvedValue({
      success: true,
      version: "2.0.0",
      qualityProfiles: [{ id: 1, name: "Any" }],
      metadataProfiles: [{ id: 1, name: "Standard" }],
      rootFolderPaths: [{ id: 1, path: "/music" }],
    });

    renderOnboarding();

    fireEvent.click(screen.getByText("Get Started"));

    fireEvent.change(screen.getByTestId("lidarr-url-input"), {
      target: { value: "http://lidarr:8686" },
    });
    fireEvent.change(screen.getByTestId("lidarr-apikey-input"), {
      target: { value: "testkey" },
    });
    fireEvent.click(screen.getByText("Test Connection"));

    await waitFor(() => {
      expect(screen.getByText("Connected! Lidarr v2.0.0")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));

    expect(screen.getByText("Last.fm")).toBeInTheDocument();
    expect(screen.getByText(/\(Optional\)/)).toBeInTheDocument();
    expect(screen.getByText("Skip")).toBeInTheDocument();
  });

  it("can skip through optional steps to complete", async () => {
    mockTestConnection.mockResolvedValue({
      success: true,
      version: "2.0.0",
      qualityProfiles: [{ id: 1, name: "Any" }],
      metadataProfiles: [{ id: 1, name: "Standard" }],
      rootFolderPaths: [{ id: 1, path: "/music" }],
    });

    renderOnboarding();

    fireEvent.click(screen.getByText("Get Started"));

    fireEvent.change(screen.getByTestId("lidarr-url-input"), {
      target: { value: "http://lidarr:8686" },
    });
    fireEvent.change(screen.getByTestId("lidarr-apikey-input"), {
      target: { value: "testkey" },
    });
    fireEvent.click(screen.getByText("Test Connection"));

    await waitFor(() => {
      expect(screen.getByText("Connected! Lidarr v2.0.0")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));

    fireEvent.click(screen.getByText("Skip"));
    fireEvent.click(screen.getByText("Skip"));
    fireEvent.click(screen.getByText("Skip"));

    expect(screen.getByText("You're all set!")).toBeInTheDocument();
    expect(screen.getByText("Go to App")).toBeInTheDocument();
  });

  it("saves settings and navigates home on finish", async () => {
    mockTestConnection.mockResolvedValue({
      success: true,
      version: "2.0.0",
      qualityProfiles: [{ id: 1, name: "Any" }],
      metadataProfiles: [{ id: 1, name: "Standard" }],
      rootFolderPaths: [{ id: 1, path: "/music" }],
    });
    mockSaveSettings.mockResolvedValue(undefined);

    renderOnboarding();

    fireEvent.click(screen.getByText("Get Started"));

    fireEvent.change(screen.getByTestId("lidarr-url-input"), {
      target: { value: "http://lidarr:8686" },
    });
    fireEvent.change(screen.getByTestId("lidarr-apikey-input"), {
      target: { value: "testkey" },
    });
    fireEvent.click(screen.getByText("Test Connection"));

    await waitFor(() => {
      expect(screen.getByText("Connected! Lidarr v2.0.0")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Skip"));
    fireEvent.click(screen.getByText("Skip"));
    fireEvent.click(screen.getByText("Skip"));
    fireEvent.click(screen.getByText("Go to App"));

    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          lidarrUrl: "http://lidarr:8686",
          lidarrApiKey: "testkey",
          lidarrRootFolderPath: "/music",
        })
      );
    });
  });

  it("shows connection failure message", async () => {
    mockTestConnection.mockResolvedValue({
      success: false,
      error: "Connection refused",
    });

    renderOnboarding();
    fireEvent.click(screen.getByText("Get Started"));

    fireEvent.change(screen.getByTestId("lidarr-url-input"), {
      target: { value: "http://bad:8686" },
    });
    fireEvent.change(screen.getByTestId("lidarr-apikey-input"), {
      target: { value: "testkey" },
    });
    fireEvent.click(screen.getByText("Test Connection"));

    await waitFor(() => {
      expect(
        screen.getByText("Connection failed: Connection refused")
      ).toBeInTheDocument();
    });
  });

  it("disables next on connection step until test succeeds", () => {
    renderOnboarding();
    fireEvent.click(screen.getByText("Get Started"));
    expect(screen.getByText("Next")).toBeDisabled();
  });

  it("can navigate back from connection step", () => {
    renderOnboarding();
    fireEvent.click(screen.getByText("Get Started"));
    expect(screen.getByText("Lidarr Connection")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByText("Welcome to Tunearr")).toBeInTheDocument();
  });

  describe("import step validation", () => {
    async function navigateToImportStep() {
      mockTestConnection.mockResolvedValue({
        success: true,
        version: "2.0.0",
        qualityProfiles: [{ id: 1, name: "Any" }],
        metadataProfiles: [{ id: 1, name: "Standard" }],
        rootFolderPaths: [{ id: 1, path: "/music" }],
      });

      renderOnboarding();
      fireEvent.click(screen.getByText("Get Started"));

      fireEvent.change(screen.getByTestId("lidarr-url-input"), {
        target: { value: "http://lidarr:8686" },
      });
      fireEvent.change(screen.getByTestId("lidarr-apikey-input"), {
        target: { value: "testkey" },
      });
      fireEvent.click(screen.getByText("Test Connection"));

      await waitFor(() => {
        expect(
          screen.getByText("Connected! Lidarr v2.0.0")
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Next"));
      fireEvent.click(screen.getByText("Next"));
      fireEvent.click(screen.getByText("Skip"));
      fireEvent.click(screen.getByText("Skip"));

      expect(screen.getByTestId("import-path-input")).toBeInTheDocument();
    }

    it("shows loading state during validation", async () => {
      let resolveFetch!: (value: unknown) => void;
      mockFetch.mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
      );

      await navigateToImportStep();

      fireEvent.change(screen.getByTestId("import-path-input"), {
        target: { value: "/some/path" },
      });

      fireEvent.click(screen.getByText("Next"));

      await waitFor(() => {
        expect(screen.getByText("Checking...")).toBeInTheDocument();
      });

      await act(async () => {
        resolveFetch({ ok: true, json: async () => ({ valid: true }) });
      });

      await waitFor(() => {
        expect(screen.getByText("Complete")).toBeInTheDocument();
      });
    });

    it("shows error from preNext validation", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({
          error:
            'Import path "/bad" does not exist. Make sure the directory is created or the volume is mounted.',
        }),
      });

      await navigateToImportStep();

      fireEvent.change(screen.getByTestId("import-path-input"), {
        target: { value: "/bad" },
      });

      fireEvent.click(screen.getByText("Next"));

      await waitFor(() => {
        expect(screen.getByText(/does not exist/)).toBeInTheDocument();
      });

      expect(screen.getByTestId("import-path-input")).toBeInTheDocument();
    });

    it("skip bypasses validation on import step", async () => {
      await navigateToImportStep();

      fireEvent.change(screen.getByTestId("import-path-input"), {
        target: { value: "/any/path" },
      });

      fireEvent.click(screen.getByText("Skip"));

      expect(screen.getByText("Complete")).toBeInTheDocument();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
