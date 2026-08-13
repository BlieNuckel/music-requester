import { render, screen } from "@testing-library/react";
import RecommendationTraceModal from "../RecommendationTraceModal";
import type {
  WithinTasteTrace,
  ExploreTrace,
  PersonalTrace,
} from "@/hooks/usePromotedAlbums";

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

const personalTrace: PersonalTrace = {
  kind: "personal",
  seedArtist: "Slowdive",
  seedGenres: ["shoegaze", "dream pop"],
  candidates: [
    {
      name: "Near Band",
      score: 0.9,
      genres: ["shoegaze", "noise pop"],
      genreOverlap: 0.5,
      isDifferentGenre: false,
      chosen: true,
    },
  ],
  chosenArtist: "Near Band",
  chosenGenres: ["shoegaze", "noise pop"],
  sharedGenres: ["shoegaze"],
  widened: false,
  selectionReason: "preferred_non_library",
};

function renderPersonalModal(overrides?: Partial<PersonalTrace>) {
  return render(
    <RecommendationTraceModal
      isOpen={true}
      onClose={vi.fn()}
      trace={{ ...personalTrace, ...overrides }}
      albumName="Nowhere"
      artistName="Near Band"
    />
  );
}

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

  describe("play distribution", () => {
    it("shows the spread factor for artists that carry one", () => {
      renderModal({
        plexArtists: [
          {
            name: "One Hit",
            viewCount: 50,
            picked: true,
            tagContributions: [],
            distinctTracksPlayed: 1,
            topTrackShare: 1,
            distributionFactor: 0.5,
          },
        ],
      });

      const spread = screen.getByTestId("artist-spread");
      expect(spread).toHaveTextContent("×0.50 spread");
      expect(spread).toHaveAttribute(
        "title",
        "1 track(s) played; top track is 100% of plays"
      );
    });

    it("omits the spread factor for legacy artists without track detail", () => {
      renderModal();
      expect(screen.queryByTestId("artist-spread")).not.toBeInTheDocument();
    });
  });

  describe("rating boost", () => {
    it("shows the rating multiplier and the breadth that refuted the spread", () => {
      renderModal({
        plexArtists: [
          {
            name: "Deep Cut Fan",
            viewCount: 50,
            picked: true,
            tagContributions: [],
            distinctTracksPlayed: 2,
            topTrackShare: 0.9,
            distributionFactor: 1,
            ratingBreadth: 1,
            ratingMultiplier: 1.5,
          },
        ],
      });

      expect(screen.getByTestId("artist-rating")).toHaveTextContent(
        "×1.50 rating"
      );
      expect(screen.getByTestId("artist-spread")).toHaveAttribute(
        "title",
        "2 track(s) played; top track is 90% of plays; 100% of rating evidence sits off that track"
      );
    });

    it("omits the rating multiplier for artists with nothing rated", () => {
      renderModal();
      expect(screen.queryByTestId("artist-rating")).not.toBeInTheDocument();
    });
  });

  describe("catalogue exemption", () => {
    it("shows the library track count for an exempted artist", () => {
      renderModal({
        plexArtists: [
          {
            name: "Singles Only",
            viewCount: 50,
            picked: true,
            tagContributions: [],
            availableTracks: 1,
          },
        ],
      });

      expect(screen.getByTestId("artist-catalogue")).toHaveTextContent(
        "1 in library"
      );
    });

    it("omits it for an artist that was discounted anyway", () => {
      renderModal({
        plexArtists: [
          {
            name: "Deep Catalogue",
            viewCount: 50,
            picked: true,
            tagContributions: [],
            distinctTracksPlayed: 1,
            topTrackShare: 1,
            distributionFactor: 0.5,
            availableTracks: 12,
          },
        ],
      });

      expect(screen.queryByTestId("artist-catalogue")).not.toBeInTheDocument();
      expect(screen.getByTestId("artist-spread")).toBeInTheDocument();
    });
  });

  describe("personal flow", () => {
    it("renders the seed, the neighbours, and the shared ground", () => {
      renderPersonalModal();

      expect(screen.getAllByTestId("stage-card")).toHaveLength(4);
      expect(screen.getByText("Slowdive")).toBeInTheDocument();
      expect(screen.getByTestId("chosen-candidate")).toHaveTextContent(
        "Near Band"
      );
      expect(screen.getByTestId("selection-reason")).toHaveTextContent(
        "New discovery"
      );
    });

    it("says so when the pool had to widen", () => {
      renderPersonalModal({ widened: true });
      expect(screen.getByTestId("personal-widened")).toBeInTheDocument();
    });

    it("stays quiet about widening on a normal pick", () => {
      renderPersonalModal();
      expect(screen.queryByTestId("personal-widened")).not.toBeInTheDocument();
    });
  });
});
