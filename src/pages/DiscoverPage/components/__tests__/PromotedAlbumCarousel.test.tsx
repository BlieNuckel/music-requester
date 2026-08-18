import { render, screen, fireEvent, act } from "@testing-library/react";
import PromotedAlbumCarousel from "../PromotedAlbumCarousel";
import type { PromotedAlbumData } from "@/hooks/usePromotedAlbums";

vi.mock("../PromotedAlbumCard", () => ({
  default: ({ data }: { data: PromotedAlbumData }) => (
    <div data-testid="promoted-album-card">{data.album.name}</div>
  ),
}));

function makeAlbum(index: number): PromotedAlbumData {
  return {
    mode: "within_taste",
    library: null,
    album: {
      name: `Album ${index}`,
      mbid: `alb-${index}`,
      artistName: `Artist ${index}`,
      artistMbid: `art-${index}`,
      coverUrl: `https://coverartarchive.org/release-group/alb-${index}/front-500`,
      year: "1997",
    },
    tag: "alternative",
    inLibrary: false,
    trace: {
      kind: "within_taste",
      plexArtists: [],
      weightedTags: [],
      chosenTag: { name: "alternative", weight: 1 },
      albumPool: {
        page1Count: 1,
        deepPage: 2,
        deepPageCount: 1,
        totalAfterDedup: 1,
      },
      selectionReason: "preferred_non_library",
    },
  };
}

const albums = [1, 2, 3, 4, 5].map(makeAlbum);

const mockRefresh = vi.fn();

function renderCarousel(
  props: Partial<React.ComponentProps<typeof PromotedAlbumCarousel>> = {}
) {
  return render(
    <PromotedAlbumCarousel
      albums={albums}
      loading={false}
      onRefresh={mockRefresh}
      {...props}
    />
  );
}

function track() {
  return document.querySelector<HTMLElement>("[style*='translateX']");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PromotedAlbumCarousel", () => {
  it("renders the section heading", () => {
    renderCarousel();
    expect(screen.getByText("Recommended for you")).toBeInTheDocument();
  });

  it("renders one card per album", () => {
    renderCarousel();
    expect(screen.getAllByTestId("promoted-album-card")).toHaveLength(5);
  });

  it("starts on the first slide", () => {
    renderCarousel();
    expect(track()).toHaveStyle({ transform: "translateX(-0%)" });
    expect(screen.getByLabelText("Previous recommendation")).toBeDisabled();
  });

  it("advances to the next slide", () => {
    renderCarousel();
    fireEvent.click(screen.getByLabelText("Next recommendation"));
    expect(track()).toHaveStyle({ transform: "translateX(-100%)" });
  });

  it("goes back to the previous slide", () => {
    renderCarousel();
    fireEvent.click(screen.getByLabelText("Next recommendation"));
    fireEvent.click(screen.getByLabelText("Previous recommendation"));
    expect(track()).toHaveStyle({ transform: "translateX(-0%)" });
  });

  it("disables next on the last slide", () => {
    renderCarousel();
    const next = screen.getByLabelText("Next recommendation");
    for (let i = 0; i < 4; i += 1) fireEvent.click(next);

    expect(track()).toHaveStyle({ transform: "translateX(-400%)" });
    expect(next).toBeDisabled();
  });

  it("jumps to a slide via its dot", () => {
    renderCarousel();
    fireEvent.click(screen.getByLabelText("Show recommendation 4"));
    expect(track()).toHaveStyle({ transform: "translateX(-300%)" });
  });

  it("marks the active dot as selected", () => {
    renderCarousel();
    fireEvent.click(screen.getByLabelText("Show recommendation 2"));
    expect(screen.getByLabelText("Show recommendation 2")).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByLabelText("Show recommendation 1")).toHaveAttribute(
      "aria-selected",
      "false"
    );
  });

  it("marks inactive slides as inert", () => {
    renderCarousel();
    const slides = screen.getAllByRole("group", { name: /of 5/ });
    expect(slides[0]).not.toHaveAttribute("inert");
    expect(slides[1]).toHaveAttribute("inert");
  });

  it("advances on a left swipe", () => {
    renderCarousel();
    const carousel = screen.getByLabelText("Recommended albums");
    fireEvent.touchStart(carousel, { touches: [{ clientX: 200 }] });
    fireEvent.touchEnd(carousel, { changedTouches: [{ clientX: 100 }] });
    expect(track()).toHaveStyle({ transform: "translateX(-100%)" });
  });

  it("goes back on a right swipe", () => {
    renderCarousel();
    fireEvent.click(screen.getByLabelText("Show recommendation 3"));

    const carousel = screen.getByLabelText("Recommended albums");
    fireEvent.touchStart(carousel, { touches: [{ clientX: 100 }] });
    fireEvent.touchEnd(carousel, { changedTouches: [{ clientX: 220 }] });
    expect(track()).toHaveStyle({ transform: "translateX(-100%)" });
  });

  it("ignores a swipe shorter than the threshold", () => {
    renderCarousel();
    const carousel = screen.getByLabelText("Recommended albums");
    fireEvent.touchStart(carousel, { touches: [{ clientX: 200 }] });
    fireEvent.touchEnd(carousel, { changedTouches: [{ clientX: 180 }] });
    expect(track()).toHaveStyle({ transform: "translateX(-0%)" });
  });

  it("hides the arrows and dots for a single album", () => {
    renderCarousel({ albums: [albums[0]] });
    expect(
      screen.queryByLabelText("Next recommendation")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Show recommendation 1")
    ).not.toBeInTheDocument();
  });

  it("calls onRefresh after the shuffle animation", () => {
    vi.useFakeTimers();
    renderCarousel();
    fireEvent.click(screen.getByLabelText("Shuffle recommendations"));

    expect(mockRefresh).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(mockRefresh).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("returns to the first slide on shuffle", () => {
    vi.useFakeTimers();
    renderCarousel();
    fireEvent.click(screen.getByLabelText("Show recommendation 3"));
    expect(track()).toHaveStyle({ transform: "translateX(-200%)" });

    fireEvent.click(screen.getByLabelText("Shuffle recommendations"));
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(track()).toHaveStyle({ transform: "translateX(-0%)" });
    vi.useRealTimers();
  });

  it("disables the shuffle button during the animation", () => {
    vi.useFakeTimers();
    renderCarousel();
    const button = screen.getByLabelText("Shuffle recommendations");

    fireEvent.click(button);
    expect(button).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(button).not.toBeDisabled();
    vi.useRealTimers();
  });

  it("shows a skeleton and no cards while loading", () => {
    renderCarousel({ loading: true });
    expect(screen.queryByTestId("promoted-album-card")).not.toBeInTheDocument();
    expect(
      document.querySelectorAll(".animate-pulse, .animate-shimmer").length
    ).toBeGreaterThan(0);
  });

  it("disables the shuffle button while loading", () => {
    renderCarousel({ loading: true });
    expect(screen.getByLabelText("Shuffle recommendations")).toBeDisabled();
  });

  it("explains that the profile is being built instead of showing an empty frame", () => {
    renderCarousel({ albums: [], building: true });

    expect(screen.getByText("Building your taste profile")).toBeInTheDocument();
    expect(screen.queryByTestId("promoted-album-card")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Shuffle recommendations")).toBeDisabled();
  });

  it("clamps the active slide when the album list shrinks", () => {
    const { rerender } = renderCarousel();
    fireEvent.click(screen.getByLabelText("Show recommendation 5"));
    expect(track()).toHaveStyle({ transform: "translateX(-400%)" });

    rerender(
      <PromotedAlbumCarousel
        albums={albums.slice(0, 2)}
        loading={false}
        onRefresh={mockRefresh}
      />
    );

    expect(track()).toHaveStyle({ transform: "translateX(-100%)" });
  });
});

describe("failed load", () => {
  it("offers a retry instead of an empty frame", () => {
    renderCarousel({ albums: [], error: "Failed to fetch promoted albums" });

    expect(
      screen.getByText("Couldn't load recommendations")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("shows the albums it still has rather than the failure", () => {
    renderCarousel({ error: "Failed to fetch promoted albums" });

    expect(screen.getAllByTestId("promoted-album-card")).toHaveLength(5);
    expect(
      screen.queryByText("Couldn't load recommendations")
    ).not.toBeInTheDocument();
  });

  it("prefers the skeleton while a retry is in flight", () => {
    renderCarousel({
      albums: [],
      loading: true,
      error: "Failed to fetch promoted albums",
    });

    expect(
      screen.queryByText("Couldn't load recommendations")
    ).not.toBeInTheDocument();
  });
});
