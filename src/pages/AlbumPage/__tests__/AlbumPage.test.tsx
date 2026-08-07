import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AlbumPage from "../AlbumPage";
import type { AlbumDetails, ReleaseGroup } from "@/types";

let mockState: {
  album: AlbumDetails | null;
  moreFromArtist: ReleaseGroup[];
  loading: boolean;
  error: string | null;
};

vi.mock("@/hooks/useReleaseGroupDetails", () => ({
  default: () => mockState,
}));

vi.mock("@/hooks/useLibraryAlbums", () => ({
  default: () => ({
    isAlbumInLibrary: (id: string) => id === "rg-1",
    getTrackAvailability: (id: string) =>
      id === "rg-1" ? { available: 9, total: 12 } : null,
  }),
}));

vi.mock("@/hooks/useWantedAlbums", () => ({
  default: () => ({ isAlbumWanted: (id: string) => id === "rg-1" }),
}));

vi.mock("../components/AlbumHeader", () => ({
  default: ({
    album,
    inLibrary,
    initialWanted,
    trackAvailability,
  }: {
    album: AlbumDetails;
    inLibrary?: boolean;
    initialWanted?: boolean;
    trackAvailability?: { available: number; total: number } | null;
  }) => (
    <div
      data-testid="album-header"
      data-in-library={inLibrary}
      data-wanted={initialWanted}
      data-track-availability={
        trackAvailability
          ? `${trackAvailability.available}/${trackAvailability.total}`
          : undefined
      }
    >
      {album.title}
    </div>
  ),
}));

vi.mock("../components/AlbumTracklist", () => ({
  default: ({ albumMbid }: { albumMbid: string }) => (
    <div data-testid="album-tracklist">{albumMbid}</div>
  ),
}));

vi.mock("@/pages/ArtistPage/components/ReleaseSectionGrid", () => ({
  default: ({ title, items }: { title: string; items: ReleaseGroup[] }) => (
    <div data-testid="more-from-artist" data-count={items.length}>
      {title}
      {items.map((rg) => (
        <span key={rg.id}>{rg.title}</span>
      ))}
    </div>
  ),
}));

const makeAlbum = (overrides: Partial<AlbumDetails> = {}): AlbumDetails => ({
  mbid: "rg-1",
  title: "OK Computer",
  artistName: "Radiohead",
  artistMbid: "a1",
  firstReleaseDate: "1997-06-16",
  primaryType: "Album",
  secondaryTypes: [],
  label: null,
  ...overrides,
});

const makeRg = (id: string, title: string): ReleaseGroup => ({
  id,
  score: 0,
  title,
  "primary-type": "Album",
  "first-release-date": "",
  "artist-credit": [],
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/album/rg-1"]}>
      <Routes>
        <Route path="/album/:mbid" element={<AlbumPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockState = {
    album: null,
    moreFromArtist: [],
    loading: false,
    error: null,
  };
});

describe("AlbumPage", () => {
  it("shows a skeleton while loading", () => {
    mockState.loading = true;
    renderPage();
    expect(
      document.querySelectorAll(".animate-shimmer").length
    ).toBeGreaterThan(0);
  });

  it("shows an error state when the album fails to load", () => {
    mockState.error = "Album not found";
    renderPage();
    expect(screen.getByText("Album not found")).toBeInTheDocument();
  });

  it("renders the header and tracklist", () => {
    mockState.album = makeAlbum();
    renderPage();

    expect(screen.getByTestId("album-header")).toHaveTextContent("OK Computer");
    expect(screen.getByTestId("album-tracklist")).toHaveTextContent("rg-1");
  });

  it("passes library and wanted status to the header", () => {
    mockState.album = makeAlbum();
    renderPage();

    const header = screen.getByTestId("album-header");
    expect(header).toHaveAttribute("data-in-library", "true");
    expect(header).toHaveAttribute("data-wanted", "true");
    expect(header).toHaveAttribute("data-track-availability", "9/12");
  });

  it("renders more-from-artist excluding the current album", () => {
    mockState.album = makeAlbum();
    mockState.moreFromArtist = [
      makeRg("rg-1", "OK Computer"),
      makeRg("rg-2", "Kid A"),
    ];
    renderPage();

    const grid = screen.getByTestId("more-from-artist");
    expect(grid).toHaveAttribute("data-count", "1");
    expect(screen.getByText("Kid A")).toBeInTheDocument();
  });

  it("hides more-from-artist when there are no other releases", () => {
    mockState.album = makeAlbum();
    mockState.moreFromArtist = [];
    renderPage();

    expect(screen.queryByTestId("more-from-artist")).not.toBeInTheDocument();
  });
});
