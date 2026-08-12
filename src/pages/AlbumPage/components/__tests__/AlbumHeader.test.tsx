import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AlbumHeader from "../AlbumHeader";
import type { AlbumDetails, ReleaseGroup } from "@/types";

let receivedReleaseGroup: ReleaseGroup | null = null;

vi.mock("../AlbumActions", () => ({
  default: ({ releaseGroup }: { releaseGroup: ReleaseGroup }) => {
    receivedReleaseGroup = releaseGroup;
    return <div data-testid="album-actions" />;
  },
}));

const makeAlbum = (overrides: Partial<AlbumDetails> = {}): AlbumDetails => ({
  mbid: "rg-1",
  title: "OK Computer",
  artistName: "Radiohead",
  artistMbid: "a1",
  firstReleaseDate: "1997-06-16",
  primaryType: "Album",
  secondaryTypes: [],
  label: { name: "Parlophone", mbid: "label-1" },
  ...overrides,
});

function renderHeader(
  album: AlbumDetails,
  props: Partial<ComponentProps<typeof AlbumHeader>> = {}
) {
  return render(
    <MemoryRouter>
      <AlbumHeader album={album} {...props} />
    </MemoryRouter>
  );
}

afterEach(() => {
  receivedReleaseGroup = null;
});

describe("AlbumHeader", () => {
  it("renders the album title and a subtitle of type, year and label", () => {
    renderHeader(makeAlbum());

    expect(
      screen.getByRole("heading", { name: "OK Computer" })
    ).toBeInTheDocument();
    expect(screen.getByText("Album · 1997 · Parlophone")).toBeInTheDocument();
  });

  it("links the artist name to the artist page when an MBID is present", () => {
    renderHeader(makeAlbum());

    const link = screen.getByRole("link", { name: "Radiohead" });
    expect(link).toHaveAttribute("href", "/artist/a1");
  });

  it("renders the artist as plain text when no MBID is present", () => {
    renderHeader(makeAlbum({ artistMbid: null }));

    expect(
      screen.queryByRole("link", { name: "Radiohead" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("Radiohead")).toBeInTheDocument();
  });

  it("builds the action card from the album details", () => {
    renderHeader(makeAlbum());

    expect(screen.getByTestId("album-actions")).toBeInTheDocument();
    expect(receivedReleaseGroup?.id).toBe("rg-1");
    expect(receivedReleaseGroup?.["artist-credit"][0]?.artist.id).toBe("a1");
  });

  it("shows track availability for a partially downloaded album", () => {
    renderHeader(makeAlbum(), {
      inLibrary: true,
      library: { state: "partial", available: 9, total: 12 },
    });

    expect(screen.getByText("9/12 tracks")).toBeInTheDocument();
  });

  it("says in library only when every track is downloaded", () => {
    renderHeader(makeAlbum(), {
      inLibrary: true,
      library: { state: "complete", available: 12, total: 12 },
    });

    expect(screen.getByText("In library")).toBeInTheDocument();
  });

  it("shows 0 of n tracks for a monitored album with no files", () => {
    renderHeader(makeAlbum(), {
      inLibrary: true,
      library: { state: "requested", available: 0, total: 7 },
    });

    const pill = screen.getByText("0/7 tracks");
    expect(pill).toHaveAttribute("title", "Requested, not downloaded");
  });

  it("shows no pill when the album is not in Lidarr", () => {
    renderHeader(makeAlbum(), { inLibrary: false, library: null });

    expect(screen.queryByText(/tracks/)).not.toBeInTheDocument();
    expect(screen.queryByText("In library")).not.toBeInTheDocument();
  });
});
