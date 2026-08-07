import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import ReleaseGroupCard from "../ReleaseGroupCard";
import type { Option } from "../OptionMenu";
import type { ReleaseGroup } from "../../types";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

let capturedOptions: Option[] | null = null;

vi.mock("../ContextMenu", () => ({
  default: ({
    options,
    children,
  }: {
    options: Option[];
    children: ReactNode;
  }) => {
    capturedOptions = options;
    return <div data-testid="context-menu">{children}</div>;
  },
}));

vi.mock("../AlbumActionModals", () => ({ default: () => null }));

const mockContextOptions: Option[] = [
  { label: "Add to wanted", onClick: vi.fn() },
  { label: "Go to artist", onClick: vi.fn() },
];

vi.mock("../../hooks/useAlbumActions", () => ({
  default: () => ({ contextOptions: mockContextOptions }),
}));

const makeReleaseGroup = (
  overrides: Partial<ReleaseGroup> = {}
): ReleaseGroup => ({
  id: "abc-123",
  score: 100,
  title: "Test Album",
  "primary-type": "Album",
  "first-release-date": "2023-05-10",
  "artist-credit": [
    { name: "Test Artist", artist: { id: "a1", name: "Test Artist" } },
  ],
  ...overrides,
});

describe("ReleaseGroupCard", () => {
  afterEach(() => {
    vi.clearAllMocks();
    capturedOptions = null;
  });

  it("renders album title, artist name, and year", () => {
    render(<ReleaseGroupCard releaseGroup={makeReleaseGroup()} />);

    expect(screen.getAllByText("Test Album").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Test Artist").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("2023").length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'Unknown Artist' when artist-credit is empty", () => {
    render(
      <ReleaseGroupCard
        releaseGroup={makeReleaseGroup({ "artist-credit": [] })}
      />
    );

    expect(screen.getAllByText("Unknown Artist").length).toBeGreaterThanOrEqual(
      1
    );
  });

  it("hides year when first-release-date is empty", () => {
    render(
      <ReleaseGroupCard
        releaseGroup={makeReleaseGroup({ "first-release-date": "" })}
      />
    );

    expect(screen.queryByText(/^\d{4}$/)).not.toBeInTheDocument();
  });

  it("navigates to the album page when the desktop card is clicked", () => {
    render(<ReleaseGroupCard releaseGroup={makeReleaseGroup()} />);

    fireEvent.click(screen.getByTestId("release-group-card"));
    expect(mockNavigate).toHaveBeenCalledWith("/album/abc-123");
  });

  it("navigates from the mobile card too", () => {
    render(<ReleaseGroupCard releaseGroup={makeReleaseGroup()} />);

    fireEvent.click(screen.getByTestId("release-group-card-mobile"));
    expect(mockNavigate).toHaveBeenCalledWith("/album/abc-123");
  });

  it("passes the album's context options to the ContextMenu wrapper", () => {
    render(<ReleaseGroupCard releaseGroup={makeReleaseGroup()} />);

    expect(screen.getByTestId("context-menu")).toBeInTheDocument();
    expect(capturedOptions).toBe(mockContextOptions);
  });

  it("does not render inline action buttons", () => {
    render(<ReleaseGroupCard releaseGroup={makeReleaseGroup()} />);

    expect(screen.queryByLabelText("More options")).not.toBeInTheDocument();
  });

  it("shows the In Library badge on both card variants when inLibrary", () => {
    render(<ReleaseGroupCard releaseGroup={makeReleaseGroup()} inLibrary />);

    expect(screen.getAllByLabelText("In Library")).toHaveLength(2);
  });

  it("hides the In Library badge when not in library", () => {
    render(<ReleaseGroupCard releaseGroup={makeReleaseGroup()} />);

    expect(screen.queryByLabelText("In Library")).not.toBeInTheDocument();
  });
});
