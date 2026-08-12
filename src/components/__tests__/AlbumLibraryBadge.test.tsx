import { render, screen } from "@testing-library/react";
import AlbumLibraryBadge, { AlbumLibraryPill } from "../AlbumLibraryBadge";

describe("AlbumLibraryBadge", () => {
  it("labels the badge with the passed text", () => {
    render(<AlbumLibraryBadge state="requested" label="Wanted" />);

    expect(screen.getByLabelText("Wanted")).toHaveAttribute("title", "Wanted");
  });

  it("uses the amber fill for downloaded albums", () => {
    render(<AlbumLibraryBadge state="complete" label="In library" />);

    expect(screen.getByLabelText("In library").className).toContain(
      "bg-amber-300"
    );
  });

  it("uses a muted fill for albums with no files", () => {
    render(<AlbumLibraryBadge state="requested" label="Not downloaded" />);

    const badge = screen.getByLabelText("Not downloaded");
    expect(badge.className).toContain("bg-gray-200");
    expect(badge.className).not.toContain("bg-amber-300");
  });

  it("applies positioning classes from the caller", () => {
    render(
      <AlbumLibraryBadge
        state="complete"
        label="In library"
        className="absolute bottom-1 right-1"
      />
    );

    expect(screen.getByLabelText("In library").className).toContain(
      "absolute bottom-1 right-1"
    );
  });
});

describe("AlbumLibraryPill", () => {
  it("shows the label and the fuller title", () => {
    render(
      <AlbumLibraryPill info={{ state: "partial", available: 3, total: 7 }} />
    );

    const pill = screen.getByText("3/7 tracks");
    expect(pill).toHaveAttribute("title", "Partially downloaded — 3/7 tracks");
  });

  it("reads as in library only when complete", () => {
    render(
      <AlbumLibraryPill info={{ state: "complete", available: 7, total: 7 }} />
    );

    expect(screen.getByText("In library")).toBeInTheDocument();
  });
});
