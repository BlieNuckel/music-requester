import { render, screen } from "@testing-library/react";
import SpotlightSection from "../SpotlightSection";

const mockRefresh = vi.fn();

let mockPromotedAlbums: unknown[] = [];
let mockLoading = false;
let mockBuilding = false;
let mockError: string | null = null;

vi.mock("@/hooks/usePromotedAlbums", () => ({
  default: () => ({
    promotedAlbums: mockPromotedAlbums,
    building: mockBuilding,
    loading: mockLoading,
    error: mockError,
    refresh: mockRefresh,
  }),
}));

vi.mock("../../PromotedAlbumCarousel", () => ({
  default: ({
    albums,
    loading,
    building,
  }: {
    albums: unknown[];
    loading: boolean;
    building?: boolean;
  }) => (
    <div
      data-testid="promoted-album-carousel"
      data-count={albums.length}
      data-building={String(Boolean(building))}
    >
      {loading ? "loading" : "loaded"}
    </div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockPromotedAlbums = [];
  mockLoading = false;
  mockBuilding = false;
  mockError = null;
});

describe("SpotlightSection", () => {
  it("renders the carousel while loading", () => {
    mockLoading = true;
    render(<SpotlightSection onStatusChange={vi.fn()} />);
    expect(screen.getByTestId("promoted-album-carousel")).toBeInTheDocument();
  });

  it("passes every album through to the carousel", () => {
    mockPromotedAlbums = [
      { album: { name: "OK Computer" } },
      { album: { name: "Homogenic" } },
    ];
    render(<SpotlightSection onStatusChange={vi.fn()} />);
    expect(screen.getByTestId("promoted-album-carousel")).toHaveAttribute(
      "data-count",
      "2"
    );
  });

  it("renders nothing when loaded without data", () => {
    render(<SpotlightSection onStatusChange={vi.fn()} />);
    expect(
      screen.queryByTestId("promoted-album-carousel")
    ).not.toBeInTheDocument();
  });

  it("reports loading while the hook is loading", () => {
    mockLoading = true;
    const onStatusChange = vi.fn();
    render(<SpotlightSection onStatusChange={onStatusChange} />);
    expect(onStatusChange).toHaveBeenCalledWith("loading");
  });

  it("reports ready when data arrives", () => {
    mockPromotedAlbums = [{ album: { name: "OK Computer" } }];
    const onStatusChange = vi.fn();
    render(<SpotlightSection onStatusChange={onStatusChange} />);
    expect(onStatusChange).toHaveBeenCalledWith("ready");
  });

  it("reports empty when loaded without data", () => {
    const onStatusChange = vi.fn();
    render(<SpotlightSection onStatusChange={onStatusChange} />);
    expect(onStatusChange).toHaveBeenCalledWith("empty");
  });

  it("keeps the tile and tells the carousel while the profile is building", () => {
    mockBuilding = true;
    const onStatusChange = vi.fn();
    render(<SpotlightSection onStatusChange={onStatusChange} />);

    expect(screen.getByTestId("promoted-album-carousel")).toHaveAttribute(
      "data-building",
      "true"
    );
    expect(onStatusChange).toHaveBeenCalledWith("loading");
    expect(onStatusChange).not.toHaveBeenCalledWith("empty");
  });

  it("reports error when the hook errors", () => {
    mockError = "boom";
    const onStatusChange = vi.fn();
    render(<SpotlightSection onStatusChange={onStatusChange} />);
    expect(onStatusChange).toHaveBeenCalledWith("error");
  });
});
