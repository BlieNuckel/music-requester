import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RecommendationsSettingsPage from "../RecommendationsSettingsPage";
import { DEFAULT_PROMOTED_ALBUM } from "@/context/promotedAlbumDefaults";
import type { AppSettings } from "@/context/settingsContextDef";
import { ThemeContext } from "@/context/themeContextDef";
import type { RecommenderGraph } from "@shared/recommenderGraph";

const { mockUseSettings } = vi.hoisted(() => ({
  mockUseSettings: vi.fn(),
}));

vi.mock("@/context/useSettings", () => ({
  useSettings: () => mockUseSettings(),
}));

const graph: RecommenderGraph = {
  nodes: [
    {
      id: "ratingMultiplier",
      title: "Rating boost",
      scope: "profile",
      kind: "step",
      summary: "Scales each artist's weight by how highly you rate them.",
      flow: "spotlight",
      params: [
        {
          key: "ratingWeight",
          kind: "int",
          label: "Rating weight",
          min: 0,
          max: 3,
          step: 0.1,
          formula: "weight x (1 + {ratingWeight} x stars/10)",
          description: "How much your ratings boost an artist.",
        },
      ],
      usesParams: [],
      spendsBudget: false,
      status: "live",
    },
  ],
  edges: [],
  retiredParams: [
    {
      key: "minAvailableTracksForDistribution",
      kind: "int",
      label: "Small catalogue exemption",
      min: 0,
      max: 50,
      step: 1,
      description: "Artists with few tracks keep their full weight.",
      reason: "The discount measures concentration against chance now.",
    },
  ],
  budgets: [],
};

const savePartialSettings = vi.fn().mockResolvedValue(undefined);

function setSettings(isLoading = false) {
  mockUseSettings.mockReturnValue({
    settings: { promotedAlbum: DEFAULT_PROMOTED_ALBUM } as AppSettings,
    isLoading,
    savePartialSettings,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setSettings();
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => graph,
  }) as unknown as typeof fetch;
});

function renderPage() {
  return render(
    <ThemeContext.Provider
      value={{
        theme: "dark",
        actualTheme: "dark",
        setTheme: vi.fn(),
        isLoading: false,
      }}
    >
      <RecommendationsSettingsPage />
    </ThemeContext.Provider>
  );
}

describe("RecommendationsSettingsPage", () => {
  it("renders the graph once it loads", async () => {
    renderPage();

    expect(await screen.findByText("Rating boost")).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/recommendations/graph",
      expect.anything()
    );
  });

  it("waits for the settings before rendering anything editable", () => {
    setSettings(true);
    renderPage();

    expect(screen.queryByText("Rating boost")).not.toBeInTheDocument();
  });

  it("saves an edit made on a node", async () => {
    renderPage();

    fireEvent.change(await screen.findByLabelText("Rating weight"), {
      target: { value: "2" },
    });

    await waitFor(() =>
      expect(savePartialSettings).toHaveBeenCalledWith({
        promotedAlbum: { ...DEFAULT_PROMOTED_ALBUM, ratingWeight: 2 },
      })
    );
  });

  it("switches to the list view and keeps editing the same knob", async () => {
    renderPage();
    await screen.findByText("Rating boost");

    fireEvent.click(screen.getByRole("button", { name: "List" }));

    expect(
      screen.getByText(/how much your ratings boost/i)
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Rating weight"), {
      target: { value: "1" },
    });

    await waitFor(() =>
      expect(savePartialSettings).toHaveBeenCalledWith({
        promotedAlbum: { ...DEFAULT_PROMOTED_ALBUM, ratingWeight: 1 },
      })
    );
  });

  it("shows one flow at a time and switches between them", async () => {
    renderPage();
    await screen.findByText("Rating boost");

    fireEvent.click(screen.getByRole("button", { name: "Plex ingestion" }));

    expect(screen.queryByText("Rating boost")).not.toBeInTheDocument();
    expect(screen.getByText(/what we read from plex/i)).toBeInTheDocument();
  });

  it("offers layout controls only where there is a layout", async () => {
    renderPage();
    await screen.findByText("Rating boost");

    expect(
      screen.getByRole("group", { name: "Direction" })
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Spacing" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "List" }));

    expect(
      screen.queryByRole("group", { name: "Direction" })
    ).not.toBeInTheDocument();
  });

  it("relays the graph out when the direction changes", async () => {
    renderPage();
    await screen.findByText("Rating boost");

    fireEvent.click(screen.getByRole("button", { name: "Down" }));

    expect(screen.getByRole("button", { name: "Down" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("Rating boost")).toBeInTheDocument();
  });

  it("resets every knob to its default", async () => {
    renderPage();
    await screen.findByText("Rating boost");

    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));

    await waitFor(() =>
      expect(savePartialSettings).toHaveBeenCalledWith({
        promotedAlbum: DEFAULT_PROMOTED_ALBUM,
      })
    );
  });

  it("says so when the graph cannot be loaded", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    renderPage();

    expect(
      await screen.findByText(/could not load the recommender graph/i)
    ).toBeInTheDocument();
  });
});
