import { render, screen, waitFor, act } from "@testing-library/react";
import { SettingsContextProvider } from "../SettingsContext";
import { useSettings } from "../useSettings";
import {
  AuthContext,
  type AuthContextValue,
  type AuthStatus,
} from "../authContextDef";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeAuthValue(
  overrides: Partial<AuthContextValue> = {}
): AuthContextValue {
  return {
    status: "authenticated" as AuthStatus,
    user: {
      id: 1,
      username: "admin",
      userType: "local",
      permissions: 1,
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
    ...overrides,
  };
}

function TestConsumer() {
  const ctx = useSettings();
  return (
    <div>
      <span data-testid="loading">{String(ctx.isLoading)}</span>
      <span data-testid="connected">{String(ctx.isConnected)}</span>
      <span data-testid="url">{ctx.settings.lidarrUrl || "none"}</span>
      <span data-testid="quality">
        {String(ctx.settings.lidarrQualityProfileId)}
      </span>
      <span data-testid="error">{ctx.loadError ?? "none"}</span>
    </div>
  );
}

function renderWithAuth(authOverrides: Partial<AuthContextValue> = {}) {
  return render(
    <AuthContext.Provider value={makeAuthValue(authOverrides)}>
      <SettingsContextProvider>
        <TestConsumer />
      </SettingsContextProvider>
    </AuthContext.Provider>
  );
}

describe("SettingsContextProvider", () => {
  it("provides initial loading state", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));

    renderWithAuth();

    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    expect(screen.getByTestId("connected")).toHaveTextContent("false");
  });

  it("sets isLoading false when not authenticated", () => {
    renderWithAuth({ status: "unauthenticated", user: null });

    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches config status instead of full settings for non-admin users", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ configured: true }), { status: 200 })
    );

    renderWithAuth({
      user: {
        id: 2,
        username: "plexuser",
        userType: "plex",
        permissions: 8,
        theme: "system",
        thumb: null,
        hasPlexToken: true,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/settings/status",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(screen.getByTestId("url")).toHaveTextContent("configured");
  });

  it("loads settings on mount", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          lidarrUrl: "http://lidarr:8686",
          lidarrApiKey: "key1",
        }),
        { status: 200 }
      )
    );

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("url")).toHaveTextContent("http://lidarr:8686");
  });

  it("does not test connection on load", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          lidarrUrl: "http://lidarr:8686",
          lidarrApiKey: "key1",
        }),
        { status: 200 }
      )
    );

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("connected")).toHaveTextContent("false");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("handles settings load failure gracefully", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("connected")).toHaveTextContent("false");
  });

  it("reports a network failure as a load error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId("error")).toHaveTextContent("Network error");
    });
  });

  it("reports a non-ok response as a load error rather than an empty install", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("nope", { status: 500 })
    );

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId("error")).toHaveTextContent(
        "Failed to load settings (500)"
      );
    });
    expect(screen.getByTestId("url")).toHaveTextContent("none");
  });

  it("keeps a saved profile id of 0 instead of substituting the default", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ lidarrQualityProfileId: 0 }), {
        status: 200,
      })
    );

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("quality")).toHaveTextContent("0");
  });

  it("discards a superseded status load when the user resolves as admin", async () => {
    let resolveStatus: (res: Response) => void = () => {};
    vi.mocked(fetch)
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveStatus = resolve;
          })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ lidarrUrl: "http://lidarr:8686" }), {
          status: 200,
        })
      );

    // Non-admin first, mirroring `user` landing after `status` on a real login.
    const { rerender } = render(
      <AuthContext.Provider
        value={makeAuthValue({
          user: {
            id: 1,
            username: "admin",
            userType: "local",
            permissions: 8,
            theme: "system",
            thumb: null,
            hasPlexToken: false,
          },
        })}
      >
        <SettingsContextProvider>
          <TestConsumer />
        </SettingsContextProvider>
      </AuthContext.Provider>
    );

    rerender(
      <AuthContext.Provider value={makeAuthValue()}>
        <SettingsContextProvider>
          <TestConsumer />
        </SettingsContextProvider>
      </AuthContext.Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("url")).toHaveTextContent("http://lidarr:8686");
    });

    // The abandoned status load lands last; it must not clobber the real settings.
    await act(async () => {
      resolveStatus(
        new Response(JSON.stringify({ configured: true }), { status: 200 })
      );
      await Promise.resolve();
    });

    expect(screen.getByTestId("url")).toHaveTextContent("http://lidarr:8686");
  });

  it("keeps loadLidarrOptionValues stable across renders", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ lidarrUrl: "http://lidarr:8686" }), {
        status: 200,
      })
    );

    const seen: Array<() => Promise<void>> = [];
    function IdentityProbe() {
      seen.push(useSettings().loadLidarrOptionValues);
      return null;
    }

    const { rerender } = render(
      <AuthContext.Provider value={makeAuthValue()}>
        <SettingsContextProvider>
          <IdentityProbe />
        </SettingsContextProvider>
      </AuthContext.Provider>
    );

    // Let the settings load land, which re-renders the provider.
    await waitFor(() => {
      expect(seen.length).toBeGreaterThan(1);
    });

    rerender(
      <AuthContext.Provider value={makeAuthValue()}>
        <SettingsContextProvider>
          <IdentityProbe />
        </SettingsContextProvider>
      </AuthContext.Provider>
    );

    // Consumers put this in effect deps; a new identity per render refetches in a loop.
    expect(new Set(seen).size).toBe(1);
  });
});
