import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ArtistPage from "../ArtistPage";
import type { ArtistDetails, ReleaseGroup } from "@/types";

let mockState: {
  artist: ArtistDetails | null;
  releaseGroups: ReleaseGroup[];
  loading: boolean;
  error: string | null;
};

vi.mock("@/hooks/useArtistDetails", () => ({
  default: () => mockState,
}));

vi.mock("@/hooks/useLibraryAlbums", () => ({
  default: () => ({
    isAlbumInLibrary: (id: string) => id === "in-lib",
  }),
}));

let mockLibraryArtistMbids: string[];

vi.mock("@/hooks/useLibraryArtists", () => ({
  default: () => ({
    isArtistInLibrary: (mbid: string) => mockLibraryArtistMbids.includes(mbid),
  }),
}));

let mockSimilar: { artists: unknown[]; loading: boolean };

vi.mock("@/hooks/useSimilarArtists", () => ({
  default: () => mockSimilar,
}));

vi.mock("@/components/ReleaseGroupCard", () => ({
  default: ({
    releaseGroup,
    inLibrary,
  }: {
    releaseGroup: ReleaseGroup;
    inLibrary?: boolean;
  }) => (
    <div data-testid={`rg-${releaseGroup.id}`} data-in-library={inLibrary}>
      {releaseGroup.title}
    </div>
  ),
}));

vi.mock("@/components/FollowArtistButton", () => ({
  default: () => <button>Follow</button>,
}));

const makeRg = (overrides: Partial<ReleaseGroup>): ReleaseGroup => ({
  id: "rg",
  score: 100,
  title: "Title",
  "primary-type": "Album",
  "first-release-date": "2020-01-01",
  "artist-credit": [{ name: "Artist", artist: { id: "a1", name: "Artist" } }],
  ...overrides,
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/artist/a1"]}>
      <Routes>
        <Route path="/artist/:mbid" element={<ArtistPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockState = {
    artist: null,
    releaseGroups: [],
    loading: false,
    error: null,
  };
  mockSimilar = { artists: [], loading: false };
  mockLibraryArtistMbids = ["sim-owned"];
});

describe("ArtistPage", () => {
  it("shows a skeleton while loading", () => {
    mockState.loading = true;
    renderPage();
    expect(
      document.querySelectorAll(".animate-shimmer").length
    ).toBeGreaterThan(0);
  });

  it("shows an error state when the artist fails to load", () => {
    mockState.error = "Artist not found";
    renderPage();
    expect(screen.getByText("Artist not found")).toBeInTheDocument();
  });

  it("renders sections with only the first one expanded", () => {
    mockState.artist = { mbid: "a1", name: "Radiohead", type: "Group" };
    mockState.releaseGroups = [
      makeRg({ id: "alb", title: "OK Computer", "primary-type": "Album" }),
      makeRg({ id: "ep", title: "Drill EP", "primary-type": "EP" }),
    ];
    renderPage();

    expect(
      screen.getByRole("heading", { name: "Radiohead" })
    ).toBeInTheDocument();
    expect(screen.getByText("Albums")).toBeInTheDocument();
    expect(screen.getByText("EPs")).toBeInTheDocument();
    expect(screen.getByText("OK Computer")).toBeInTheDocument();
    expect(screen.queryByText("Drill EP")).not.toBeInTheDocument();
  });

  it("shows a collapsed section's releases after expanding it", async () => {
    const user = userEvent.setup();
    mockState.artist = { mbid: "a1", name: "Radiohead", type: "Group" };
    mockState.releaseGroups = [
      makeRg({ id: "alb", title: "OK Computer", "primary-type": "Album" }),
      makeRg({ id: "ep", title: "Drill EP", "primary-type": "EP" }),
    ];
    renderPage();

    await user.click(screen.getByRole("button", { name: /EPs\s*\(1\)/ }));

    expect(screen.getByText("Drill EP")).toBeInTheDocument();
  });

  it("shows the In Library badge when the artist is in the library", () => {
    mockState.artist = { mbid: "a1", name: "Radiohead" };
    mockLibraryArtistMbids = ["a1"];
    renderPage();

    expect(screen.getByText("In Library")).toBeInTheDocument();
  });

  it("hides the In Library badge when only an album matches the library", () => {
    mockState.artist = { mbid: "a1", name: "Radiohead" };
    mockState.releaseGroups = [makeRg({ id: "in-lib", title: "Owned" })];
    renderPage();

    expect(screen.queryByText("In Library")).not.toBeInTheDocument();
  });

  it("marks discography albums that are in the library", () => {
    mockState.artist = { mbid: "a1", name: "Radiohead" };
    mockState.releaseGroups = [
      makeRg({ id: "in-lib", title: "Owned" }),
      makeRg({ id: "missing", title: "Not owned" }),
    ];
    renderPage();

    expect(screen.getByTestId("rg-in-lib")).toHaveAttribute(
      "data-in-library",
      "true"
    );
    expect(screen.getByTestId("rg-missing")).toHaveAttribute(
      "data-in-library",
      "false"
    );
  });

  it("shows an empty message when the artist has no releases", () => {
    mockState.artist = { mbid: "a1", name: "Radiohead" };
    mockState.releaseGroups = [];
    renderPage();
    expect(
      screen.getByText("No releases found for this artist.")
    ).toBeInTheDocument();
  });

  it("renders the similar artists section when present", () => {
    mockState.artist = { mbid: "a1", name: "Radiohead" };
    mockSimilar = {
      artists: [
        { name: "Muse", mbid: "muse-1", imageUrl: "", match: 0.9 },
        { name: "Coldplay", mbid: "sim-owned", imageUrl: "", match: 0.8 },
      ],
      loading: false,
    };
    renderPage();

    expect(screen.getByText("Similar artists")).toBeInTheDocument();
    expect(screen.getByText("Muse")).toBeInTheDocument();
    expect(screen.getByText("Coldplay")).toBeInTheDocument();
  });

  it("omits the similar artists section when there are none", () => {
    mockState.artist = { mbid: "a1", name: "Radiohead" };
    mockSimilar = { artists: [], loading: false };
    renderPage();
    expect(screen.queryByText("Similar artists")).not.toBeInTheDocument();
  });
});
