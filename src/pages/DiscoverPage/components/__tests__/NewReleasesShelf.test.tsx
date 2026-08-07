import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NewReleasesShelf from "../NewReleasesShelf";
import type { NewReleaseItem, NewReleasesData } from "@/types";

vi.mock("@/hooks/useHaptics", () => ({
  default: () => ({ light: vi.fn() }),
}));

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeItem(overrides: Partial<NewReleaseItem> = {}): NewReleaseItem {
  return {
    releaseGroupMbid: "rg-1",
    title: "Fresh Album",
    artistName: "Some Artist",
    artistMbid: "mbid-1",
    releaseDate: "2026-07-01",
    source: "followed",
    coverUrl: "https://caa/rg-1",
    lidarrStatus: null,
    followedReleaseId: 11,
    ...overrides,
  };
}

function makeData(items: NewReleaseItem[]): NewReleasesData {
  return { items, windowDays: 30 };
}

function renderShelf(data: NewReleasesData | null, loading = false) {
  return render(
    <MemoryRouter>
      <NewReleasesShelf data={data} loading={loading} />
    </MemoryRouter>
  );
}

describe("NewReleasesShelf", () => {
  it("renders the header with a See all link to the following page", () => {
    renderShelf(makeData([makeItem()]));
    expect(screen.getByText("New releases")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See all" })).toHaveAttribute(
      "href",
      "/library/following"
    );
  });

  it("renders skeletons while loading", () => {
    const { container } = renderShelf(null, true);
    expect(
      container.querySelectorAll(".animate-shimmer").length
    ).toBeGreaterThan(0);
  });

  it("renders nothing when loaded and empty", () => {
    const { container } = renderShelf(makeData([]));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a card per item with title, artist, and source label", () => {
    renderShelf(
      makeData([
        makeItem(),
        makeItem({
          releaseGroupMbid: "rg-2",
          title: "Library Find",
          artistName: "Lib Artist",
          source: "library",
          followedReleaseId: null,
        }),
        makeItem({
          releaseGroupMbid: "rg-3",
          title: "Similar Find",
          artistName: "Sim Artist",
          source: "similar",
          followedReleaseId: null,
        }),
      ])
    );

    expect(screen.getByText("Fresh Album")).toBeInTheDocument();
    expect(screen.getByText("Following")).toBeInTheDocument();
    expect(screen.getByText("Library artist")).toBeInTheDocument();
    expect(screen.getByText("Similar artist")).toBeInTheDocument();
  });

  it("links to the album page when an MBID exists", () => {
    renderShelf(makeData([makeItem()]));
    expect(
      screen.getByRole("link", { name: "Fresh Album by Some Artist" })
    ).toHaveAttribute("href", "/album/rg-1");
  });

  it("falls back to a search link without an MBID", () => {
    renderShelf(
      makeData([makeItem({ releaseGroupMbid: null, followedReleaseId: null })])
    );
    expect(
      screen.getByRole("link", { name: "Fresh Album by Some Artist" })
    ).toHaveAttribute(
      "href",
      `/search?q=${encodeURIComponent("Some Artist Fresh Album")}`
    );
  });

  it("shows the grab-status badge when Lidarr knows the album", () => {
    renderShelf(makeData([makeItem({ lidarrStatus: "imported" })]));
    expect(screen.getByLabelText("In library")).toBeInTheDocument();
  });

  it("shows no badge when Lidarr status is null", () => {
    renderShelf(makeData([makeItem()]));
    expect(screen.queryByLabelText("In library")).not.toBeInTheDocument();
  });

  it("marks a followed release viewed on click", () => {
    renderShelf(makeData([makeItem({ followedReleaseId: 42 })]));
    fireEvent.click(
      screen.getByRole("link", { name: "Fresh Album by Some Artist" })
    );
    expect(mockFetch).toHaveBeenCalledWith("/api/followed/releases/42/viewed", {
      method: "POST",
    });
  });

  it("does not call the viewed endpoint for feed items", () => {
    renderShelf(
      makeData([makeItem({ source: "library", followedReleaseId: null })])
    );
    fireEvent.click(
      screen.getByRole("link", { name: "Fresh Album by Some Artist" })
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows a relative release date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
    renderShelf(makeData([makeItem({ releaseDate: "2026-07-08" })]));
    expect(screen.getByText(/yesterday/)).toBeInTheDocument();
    vi.useRealTimers();
  });
});
