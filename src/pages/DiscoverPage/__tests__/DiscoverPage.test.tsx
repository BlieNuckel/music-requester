import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DiscoverPage from "../DiscoverPage";

const render = (ui: React.ReactElement) =>
  rtlRender(ui, {
    wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
  });

const mockRefreshPromotedAlbums = vi.fn();
const mockRefreshArtists = vi.fn();

let mockPromotedAlbums: unknown[] = [];
let mockPromotedArtists: unknown = null;

vi.mock("@/hooks/usePromotedAlbums", () => ({
  default: () => ({
    promotedAlbums: mockPromotedAlbums,
    loading: false,
    error: null,
    refresh: mockRefreshPromotedAlbums,
  }),
}));

vi.mock("@/hooks/usePromotedArtists", () => ({
  default: () => ({
    promotedArtists: mockPromotedArtists,
    loading: false,
    error: null,
    refresh: mockRefreshArtists,
  }),
}));

vi.mock("../components/PromotedAlbumCarousel", () => ({
  default: ({
    albums,
    onRefresh,
  }: {
    albums: { album: { name: string } }[];
    onRefresh: () => void;
  }) => (
    <div data-testid="promoted-album">
      {albums.map((a) => (
        <span key={a.album.name}>{a.album.name}</span>
      ))}
      <button onClick={onRefresh}>Refresh Album</button>
    </div>
  ),
}));

vi.mock("../components/PromotedArtists", () => ({
  default: ({
    data,
    onRefresh,
  }: {
    data: { artists: { name: string }[] };
    onRefresh: () => void;
  }) => (
    <div data-testid="promoted-artists">
      {data.artists.map((a) => (
        <span key={a.name}>{a.name}</span>
      ))}
      <button onClick={onRefresh}>Refresh Artists</button>
    </div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockPromotedAlbums = [];
  mockPromotedArtists = null;
});

describe("DiscoverPage", () => {
  it("renders the Discover heading", () => {
    render(<DiscoverPage />);
    expect(screen.getByText("Discover")).toBeInTheDocument();
  });

  it("renders promoted albums when data is available", () => {
    mockPromotedAlbums = [{ album: { name: "OK Computer" } }];
    render(<DiscoverPage />);
    expect(screen.getByTestId("promoted-album")).toBeInTheDocument();
    expect(screen.getByText("OK Computer")).toBeInTheDocument();
  });

  it("does not render promoted albums when the list is empty", () => {
    mockPromotedAlbums = [];
    render(<DiscoverPage />);
    expect(screen.queryByTestId("promoted-album")).not.toBeInTheDocument();
  });

  it("calls refresh when promoted album refresh clicked", () => {
    mockPromotedAlbums = [{ album: { name: "OK Computer" } }];
    render(<DiscoverPage />);
    fireEvent.click(screen.getByText("Refresh Album"));
    expect(mockRefreshPromotedAlbums).toHaveBeenCalled();
  });

  it("renders promoted artists when data is available", () => {
    mockPromotedArtists = {
      artists: [{ name: "Boards of Canada" }],
      seedArtists: ["Aphex Twin"],
    };
    render(<DiscoverPage />);
    expect(screen.getByTestId("promoted-artists")).toBeInTheDocument();
    expect(screen.getByText("Boards of Canada")).toBeInTheDocument();
  });

  it("does not render promoted artists when data is null", () => {
    mockPromotedArtists = null;
    render(<DiscoverPage />);
    expect(screen.queryByTestId("promoted-artists")).not.toBeInTheDocument();
  });

  it("calls refresh when promoted artists refresh clicked", () => {
    mockPromotedArtists = {
      artists: [{ name: "Boards of Canada" }],
      seedArtists: [],
    };
    render(<DiscoverPage />);
    fireEvent.click(screen.getByText("Refresh Artists"));
    expect(mockRefreshArtists).toHaveBeenCalled();
  });
});
