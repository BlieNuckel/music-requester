import { render, screen, waitFor } from "@testing-library/react";
import RecommendationTraceModal from "../RecommendationTraceModal";
import {
  makeGraph,
  makeNode,
} from "@/components/recommenderGraph/__tests__/fixtures";
import { ThemeContext } from "@/context/themeContextDef";
import type { RecommendationTrace } from "@shared/recommendationTrace";

vi.mock("@/components/Modal", () => ({
  default: ({
    isOpen,
    children,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
  }) => (isOpen ? <div data-testid="modal">{children}</div> : null),
}));

const graph = makeGraph(
  [
    makeNode({
      id: "personalAlbum",
      flow: "spotlight",
      title: "Album from a neighbour",
      params: [],
    }),
    makeNode({
      id: "exploreAlbum",
      flow: "spotlight",
      title: "Album from a distant artist",
      params: [],
    }),
    makeNode({
      id: "candidateWalk",
      flow: "spotlight",
      title: "Walk the pool",
      params: [],
    }),
  ],
  [
    {
      id: "exploreAlbum->personalAlbum",
      from: "exploreAlbum",
      to: "personalAlbum",
      kind: "fallback",
      order: 0,
    },
    {
      id: "personalAlbum->candidateWalk",
      from: "personalAlbum",
      to: "candidateWalk",
      kind: "fallback",
      order: 1,
    },
  ]
);

const trace: RecommendationTrace = {
  source: "personalAlbum",
  nodes: [
    {
      nodeId: "exploreAlbum",
      ms: 4,
      summary: "nothing",
      produced: false,
      facts: [],
    },
    {
      nodeId: "personalAlbum",
      ms: 12,
      summary: "{result, rememberKey}",
      produced: true,
      facts: [
        { label: "Next to", value: "Slowdive" },
        {
          label: "Neighbours drawn from",
          more: 3,
          items: [
            { name: "Near Band", detail: "next to Slowdive", chosen: true },
            { name: "Other Band" },
          ],
        },
      ],
    },
  ],
  budget: {
    label: "MusicBrainz lookups per build",
    remaining: 27,
    of: 30,
  },
};

function renderModal(isOpen = true) {
  return render(
    <ThemeContext.Provider
      value={{
        theme: "light",
        actualTheme: "light",
        setTheme: vi.fn(),
        isLoading: false,
      }}
    >
      <RecommendationTraceModal
        isOpen={isOpen}
        onClose={vi.fn()}
        trace={trace}
        albumName="Souvlaki"
        artistName="Near Band"
      />
    </ThemeContext.Provider>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(graph) })
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RecommendationTraceModal", () => {
  it("names the record it is explaining", async () => {
    renderModal();

    expect(await screen.findByText("Why Souvlaki")).toBeInTheDocument();
  });

  it("does not render when closed, and fetches no chart nobody asked for", () => {
    renderModal(false);

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks for the spotlight flow's shape", async () => {
    renderModal();

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/recommendations/graph/spotlight",
        expect.anything()
      )
    );
  });

  it("draws the pipeline the recommendation came through", async () => {
    renderModal();

    expect(await screen.findByTestId("recommender-canvas")).toBeInTheDocument();
    expect(screen.getByText("Album from a neighbour")).toBeInTheDocument();
  });

  it("shows what each step that ran had to say", async () => {
    renderModal();

    expect(await screen.findByText("Next to")).toBeInTheDocument();
    expect(screen.getByText("Slowdive")).toBeInTheDocument();
    expect(screen.getByTestId("trace-chosen")).toHaveTextContent("Near Band");
    expect(screen.getByText("and 3 more")).toBeInTheDocument();
  });

  /**
   * "It was a personal pick, so the tag chart never ran" is the part a list of stages could
   * only imply. Here it is the difference between a card that is faded and one that is not.
   */
  it("fades the steps this recommendation never reached", async () => {
    renderModal();

    await screen.findByTestId("recommender-canvas");
    const card = (id: string) =>
      document.querySelector(`[data-testid="rf__node-${id}"] [data-kind]`);

    expect(card("candidateWalk")).toHaveAttribute("data-skipped", "true");
    expect(card("exploreAlbum")).not.toHaveAttribute("data-skipped");
    expect(card("personalAlbum")).toHaveAttribute("data-source", "true");
  });

  it("says a step ran and came up with nothing", async () => {
    renderModal();

    await screen.findByTestId("recommender-canvas");
    expect(screen.getByText("came up with nothing")).toBeInTheDocument();
  });

  it("says what the pick left of the shared lookup allowance", async () => {
    renderModal();

    expect(
      await screen.findByText(/27 of 30 musicbrainz lookups per build left/i)
    ).toBeInTheDocument();
  });
});
