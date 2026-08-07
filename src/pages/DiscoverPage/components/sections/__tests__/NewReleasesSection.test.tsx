import { render, screen } from "@testing-library/react";
import NewReleasesSection from "../NewReleasesSection";

let mockNewReleases: unknown = null;
let mockLoading = false;
let mockError: string | null = null;

vi.mock("@/hooks/useNewReleases", () => ({
  default: () => ({
    newReleases: mockNewReleases,
    loading: mockLoading,
    error: mockError,
  }),
}));

vi.mock("../../NewReleasesShelf", () => ({
  default: ({ loading }: { loading: boolean }) => (
    <div data-testid="new-releases-shelf">{loading ? "loading" : "loaded"}</div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockNewReleases = null;
  mockLoading = false;
  mockError = null;
});

function makeItem() {
  return {
    releaseGroupMbid: "rg-1",
    title: "Album",
    artistName: "Artist",
    artistMbid: "mbid-1",
    releaseDate: "2026-07-01",
    source: "followed",
    coverUrl: null,
    lidarrStatus: null,
    followedReleaseId: 1,
  };
}

describe("NewReleasesSection", () => {
  it("renders the shelf while loading", () => {
    mockLoading = true;
    render(<NewReleasesSection onStatusChange={vi.fn()} />);
    expect(screen.getByTestId("new-releases-shelf")).toBeInTheDocument();
  });

  it("renders nothing when loaded without data", () => {
    render(<NewReleasesSection onStatusChange={vi.fn()} />);
    expect(screen.queryByTestId("new-releases-shelf")).not.toBeInTheDocument();
  });

  it("reports ready when items exist", () => {
    mockNewReleases = { items: [makeItem()], windowDays: 30 };
    const onStatusChange = vi.fn();
    render(<NewReleasesSection onStatusChange={onStatusChange} />);
    expect(onStatusChange).toHaveBeenCalledWith("ready");
  });

  it("reports empty when the item list is empty", () => {
    mockNewReleases = { items: [], windowDays: 90 };
    const onStatusChange = vi.fn();
    render(<NewReleasesSection onStatusChange={onStatusChange} />);
    expect(onStatusChange).toHaveBeenCalledWith("empty");
  });

  it("reports error when the hook errors", () => {
    mockError = "boom";
    const onStatusChange = vi.fn();
    render(<NewReleasesSection onStatusChange={onStatusChange} />);
    expect(onStatusChange).toHaveBeenCalledWith("error");
  });
});
