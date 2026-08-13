import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AlbumPage from "../AlbumPage";
import type { AlbumDetails, AlbumLabel, ReleaseGroup } from "@/types";

let mockState: {
  album: AlbumDetails | null;
  loading: boolean;
  error: string | null;
};

let mockLabelState: { label: AlbumLabel | null; loading: boolean };

let mockReleaseGroupsState: {
  releaseGroups: ReleaseGroup[];
  loading: boolean;
  error: string | null;
};

let mockSimilarAlbumsState: {
  albums: ReleaseGroup[];
  loading: boolean;
  error: string | null;
};

let receivedArtistMbid: string | null | undefined;
let receivedSimilarMbid: string | null | undefined;

vi.mock("@/hooks/useReleaseGroupDetails", () => ({
  default: () => mockState,
}));

vi.mock("@/hooks/useReleaseGroupLabel", () => ({
  default: () => mockLabelState,
}));

vi.mock("@/hooks/useArtistReleaseGroups", () => ({
  default: (artistMbid: string | null | undefined) => {
    receivedArtistMbid = artistMbid;
    return mockReleaseGroupsState;
  },
}));

vi.mock("@/hooks/useSimilarAlbums", () => ({
  default: (mbid: string | null | undefined) => {
    receivedSimilarMbid = mbid;
    return mockSimilarAlbumsState;
  },
}));

vi.mock("@/hooks/useLibraryAlbums", () => ({
  default: () => ({
    isAlbumInLibrary: (id: string) => id === "rg-1",
    getAlbumLibrary: (id: string) =>
      id === "rg-1" ? { state: "partial", available: 9, total: 12 } : null,
  }),
}));

vi.mock("@/hooks/useWantedAlbums", () => ({
  default: () => ({ isAlbumWanted: (id: string) => id === "rg-1" }),
}));

vi.mock("../components/AlbumHeader", () => ({
  default: ({
    album,
    label,
    inLibrary,
    initialWanted,
    library,
  }: {
    album: AlbumDetails;
    label?: AlbumLabel | null;
    inLibrary?: boolean;
    initialWanted?: boolean;
    library?: { state: string; available: number; total: number } | null;
  }) => (
    <div
      data-testid="album-header"
      data-in-library={inLibrary}
      data-wanted={initialWanted}
      data-label={label?.name ?? "none"}
      data-library-state={library?.state}
      data-track-availability={
        library ? `${library.available}/${library.total}` : undefined
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
  default: ({
    title,
    items,
    loading,
  }: {
    title: string;
    items: ReleaseGroup[];
    loading?: boolean;
  }) => (
    <div
      data-testid={
        title === "Similar albums" ? "similar-albums" : "more-from-artist"
      }
      data-count={items.length}
      data-loading={loading}
    >
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
  mockState = { album: null, loading: false, error: null };
  mockLabelState = { label: null, loading: false };
  mockReleaseGroupsState = {
    releaseGroups: [],
    loading: false,
    error: null,
  };
  mockSimilarAlbumsState = { albums: [], loading: false, error: null };
  receivedArtistMbid = undefined;
  receivedSimilarMbid = undefined;
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
    expect(header).toHaveAttribute("data-library-state", "partial");
  });

  it("passes the separately loaded label to the header", () => {
    mockState.album = makeAlbum();
    mockLabelState = {
      label: { name: "Parlophone", mbid: "label-1" },
      loading: false,
    };
    renderPage();

    expect(screen.getByTestId("album-header")).toHaveAttribute(
      "data-label",
      "Parlophone"
    );
  });

  it("renders the header and tracklist while the discography is still loading", () => {
    mockState.album = makeAlbum();
    mockReleaseGroupsState = {
      releaseGroups: [],
      loading: true,
      error: null,
    };
    renderPage();

    expect(screen.getByTestId("album-header")).toBeInTheDocument();
    expect(screen.getByTestId("album-tracklist")).toBeInTheDocument();
    expect(screen.getByTestId("more-from-artist")).toHaveAttribute(
      "data-loading",
      "true"
    );
  });

  it("looks up more-from-artist by the album's artist MBID", () => {
    mockState.album = makeAlbum();
    renderPage();

    expect(receivedArtistMbid).toBe("a1");
  });

  it("renders more-from-artist excluding the current album", () => {
    mockState.album = makeAlbum();
    mockReleaseGroupsState.releaseGroups = [
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
    mockReleaseGroupsState.releaseGroups = [];
    renderPage();

    expect(screen.queryByTestId("more-from-artist")).not.toBeInTheDocument();
  });

  it("looks up similar albums by the route MBID", () => {
    mockState.album = makeAlbum();
    renderPage();

    expect(receivedSimilarMbid).toBe("rg-1");
  });

  it("renders similar albums", () => {
    mockState.album = makeAlbum();
    mockSimilarAlbumsState.albums = [makeRg("rg-9", "Loveless")];
    renderPage();

    const grid = screen.getByTestId("similar-albums");
    expect(grid).toHaveAttribute("data-count", "1");
    expect(screen.getByText("Loveless")).toBeInTheDocument();
  });

  it("shows the similar-albums section while it is still loading", () => {
    mockState.album = makeAlbum();
    mockSimilarAlbumsState.loading = true;
    renderPage();

    expect(screen.getByTestId("similar-albums")).toHaveAttribute(
      "data-loading",
      "true"
    );
  });

  it("hides similar albums when the endpoint returns nothing", () => {
    mockState.album = makeAlbum();
    mockSimilarAlbumsState.albums = [];
    renderPage();

    expect(screen.queryByTestId("similar-albums")).not.toBeInTheDocument();
  });
});
