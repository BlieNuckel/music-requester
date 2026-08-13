import { render, screen, waitFor } from "@testing-library/react";
import UploadPage from "../UploadPage";
import { Permission } from "@shared/permissions";

const mockNavigate = vi.fn();

let mockUser: { id: number; permissions: number } | null = {
  id: 1,
  permissions: Permission.IMPORT,
};

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams("mbid=test-mbid-123")],
  useNavigate: () => mockNavigate,
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string;
    children: React.ReactNode;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/context/useAuth", () => ({
  useAuth: () => ({
    user: mockUser,
  }),
}));

vi.mock("@/hooks/useFileUpload", () => ({
  default: () => ({
    step: "idle",
    files: [],
    items: [],
    error: null,
    addFiles: vi.fn(),
    removeFile: vi.fn(),
    startUpload: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock("@/components/ImageWithShimmer", () => ({
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = { id: 1, permissions: Permission.IMPORT };
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        artistName: "Radiohead",
        albumTitle: "OK Computer",
      }),
      { status: 200 }
    )
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UploadPage", () => {
  it("renders back link to library", () => {
    render(<UploadPage />);
    const backLinks = screen.getAllByText("Back to library");
    expect(backLinks.length).toBeGreaterThanOrEqual(1);
    expect(backLinks[0].closest("a")).toHaveAttribute(
      "href",
      "/library/wanted"
    );
  });

  it("fetches and displays release group info", async () => {
    render(<UploadPage />);

    await waitFor(() => {
      expect(screen.getByText("OK Computer")).toBeInTheDocument();
      expect(screen.getByText("Radiohead")).toBeInTheDocument();
    });
  });

  it("shows file upload zone in idle state", () => {
    render(<UploadPage />);
    expect(
      screen.getByText("Drop audio files or a folder here, or click to browse")
    ).toBeInTheDocument();
  });

  it("shows loading state while fetching release group info", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    render(<UploadPage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("fetches release group info from correct endpoint", () => {
    render(<UploadPage />);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/musicbrainz/release-group/test-mbid-123",
      { signal: expect.any(AbortSignal) }
    );
  });

  it("renders upload UI for a non-admin user with IMPORT permission", () => {
    mockUser = { id: 2, permissions: Permission.IMPORT };
    render(<UploadPage />);
    expect(
      screen.getByText("Drop audio files or a folder here, or click to browse")
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("redirects users without IMPORT permission", () => {
    mockUser = { id: 3, permissions: Permission.REQUEST };
    render(<UploadPage />);
    expect(mockNavigate).toHaveBeenCalledWith("/library/wanted", {
      replace: true,
    });
  });
});
