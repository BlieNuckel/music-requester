import { render, screen } from "@testing-library/react";
import RecommendationTraceModal from "../RecommendationTraceModal";
import type { WithinTasteTrace, ExploreTrace } from "@/hooks/usePromotedAlbums";

vi.mock("@/components/Modal", () => ({
  default: ({
    isOpen,
    children,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
  }) => (isOpen ? <div data-testid="modal">{children}</div> : null),
}));

const trace: WithinTasteTrace = {
  kind: "within_taste",
  plexArtists: [
    {
      name: "Radiohead",
      viewCount: 100,
      picked: true,
      tagContributions: [
        { tagName: "alternative", rawCount: 100, weight: 10000 },
        { tagName: "rock", rawCount: 80, weight: 8000 },
      ],
    },
    {
      name: "Bjork",
      viewCount: 50,
      picked: true,
      tagContributions: [{ tagName: "electronic", rawCount: 90, weight: 4500 }],
    },
    {
      name: "Portishead",
      viewCount: 30,
      picked: false,
      tagContributions: [],
    },
  ],
  weightedTags: [
    { name: "alternative", weight: 10000, fromArtists: ["Radiohead"] },
    { name: "rock", weight: 8000, fromArtists: ["Radiohead"] },
    { name: "electronic", weight: 4500, fromArtists: ["Bjork"] },
  ],
  chosenTag: { name: "alternative", weight: 10000 },
  albumPool: {
    page1Count: 50,
    deepPage: 4,
    deepPageCount: 48,
    totalAfterDedup: 95,
  },
  selectionReason: "preferred_non_library",
};

const exploreTrace: ExploreTrace = {
  kind: "explore",
  seedArtist: "Radiohead",
  seedGenres: ["alternative", "rock"],
  candidates: [
    {
      name: "Jazz Cat",
      score: 5000,
      genres: ["jazz", "bebop"],
      genreOverlap: 0,
      isDifferentGenre: true,
      chosen: true,
    },
    {
      name: "Rock Clone",
      score: 9000,
      genres: ["alternative", "rock"],
      genreOverlap: 1,
      isDifferentGenre: false,
      chosen: false,
    },
  ],
  chosenArtist: "Jazz Cat",
  chosenGenres: ["jazz", "bebop"],
  newGenres: ["jazz", "bebop"],
  selectionReason: "preferred_non_library",
};

function renderModal(overrides?: Partial<WithinTasteTrace>) {
  return render(
    <RecommendationTraceModal
      isOpen={true}
      onClose={vi.fn()}
      trace={{ ...trace, ...overrides }}
      albumName="OK Computer"
      artistName="Radiohead"
    />
  );
}

function renderExploreModal(overrides?: Partial<ExploreTrace>) {
  return render(
    <RecommendationTraceModal
      isOpen={true}
      onClose={vi.fn()}
      trace={{ ...exploreTrace, ...overrides }}
      albumName="Blue Album"
      artistName="Jazz Cat"
    />
  );
}

describe("RecommendationTraceModal", () => {
  it("renders all stage cards", () => {
    renderModal();
    const stageCards = screen.getAllByTestId("stage-card");
    expect(stageCards).toHaveLength(5);
  });

  it("highlights picked artists vs non-picked", () => {
    renderModal();
    const pickedArtists = screen.getAllByTestId("picked-artist");
    const regularArtists = screen.getAllByTestId("artist");
    expect(pickedArtists).toHaveLength(2);
    expect(regularArtists).toHaveLength(1);
    expect(pickedArtists[0]).toHaveTextContent("Radiohead");
    expect(pickedArtists[1]).toHaveTextContent("Bjork");
    expect(regularArtists[0]).toHaveTextContent("Portishead");
  });

  it("highlights chosen tag in pool", () => {
    renderModal();
    const chosenTag = screen.getByTestId("chosen-tag");
    expect(chosenTag).toHaveTextContent("alternative");
    const poolTags = screen.getAllByTestId("pool-tag");
    expect(poolTags).toHaveLength(2);
  });

  it("shows correct album pool counts", () => {
    renderModal();
    expect(screen.getByTestId("page1-count")).toHaveTextContent("50 albums");
    expect(screen.getByTestId("deep-page-count")).toHaveTextContent(
      "48 albums"
    );
    expect(screen.getByTestId("total-after-dedup")).toHaveTextContent(
      "95 unique albums"
    );
  });

  it("shows correct selection reason for non-library", () => {
    renderModal();
    const reason = screen.getByTestId("selection-reason");
    expect(reason).toHaveTextContent("New discovery");
  });

  it("shows correct selection reason for fallback", () => {
    renderModal({ selectionReason: "fallback_in_library" });
    const reason = screen.getByTestId("selection-reason");
    expect(reason).toHaveTextContent("Already in library");
  });

  it("shows album name and artist in result stage", () => {
    renderModal();
    expect(screen.getByText("OK Computer")).toBeInTheDocument();
    const resultStage = screen
      .getByTestId("selection-reason")
      .closest("[data-testid='stage-card']")!;
    expect(resultStage).toHaveTextContent("Radiohead");
  });

  it("does not render when closed", () => {
    render(
      <RecommendationTraceModal
        isOpen={false}
        onClose={vi.fn()}
        trace={trace}
        albumName="OK Computer"
        artistName="Radiohead"
      />
    );
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  describe("explore trace", () => {
    it("renders the explore flow stage cards", () => {
      renderExploreModal();
      const stageCards = screen.getAllByTestId("stage-card");
      expect(stageCards).toHaveLength(4);
    });

    it("does not render within-taste stages", () => {
      renderExploreModal();
      expect(screen.queryByTestId("chosen-tag")).not.toBeInTheDocument();
      expect(screen.queryByTestId("page1-count")).not.toBeInTheDocument();
    });

    it("marks the chosen candidate", () => {
      renderExploreModal();
      const chosen = screen.getByTestId("chosen-candidate");
      expect(chosen).toHaveTextContent("Jazz Cat");
      expect(screen.getAllByTestId("candidate")).toHaveLength(1);
    });

    it("labels candidates as different vs same genre", () => {
      renderExploreModal();
      expect(screen.getByText("different genre")).toBeInTheDocument();
      expect(screen.getByText("same genre")).toBeInTheDocument();
    });

    it("shows the seed artist and result", () => {
      renderExploreModal();
      expect(screen.getAllByText("Radiohead").length).toBeGreaterThan(0);
      expect(screen.getByText("Blue Album")).toBeInTheDocument();
      expect(screen.getByTestId("selection-reason")).toHaveTextContent(
        "New discovery"
      );
    });
  });
});
