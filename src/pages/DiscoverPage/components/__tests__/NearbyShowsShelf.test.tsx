import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NearbyShowsShelf from "../NearbyShowsShelf";
import type { NearbyShow } from "@/types";

function show(overrides: Partial<NearbyShow> = {}): NearbyShow {
  return {
    id: 1,
    eventKey: "jambase:100",
    name: "Show at Plan B",
    eventDate: "2026-09-05",
    previousStartDate: null,
    status: "scheduled",
    statusChangedAt: null,
    venueName: "Plan B",
    venueCity: "Malmö",
    venueCountry: "SE",
    ticketUrl: "https://tickets.test/100",
    imageUrl: null,
    distanceKm: 1.2,
    performers: [
      { jambaseId: "jambase:1", name: "Bar Italia", isHeadliner: true },
    ],
    response: null,
    viewedAt: null,
    affinity: 0.8,
    matchedGenres: ["shoegaze"],
    following: false,
    artistImageUrl: null,
    ...overrides,
  };
}

function renderShelf(shows: NearbyShow[]) {
  return render(
    <MemoryRouter>
      <NearbyShowsShelf shows={shows} />
    </MemoryRouter>
  );
}

describe("NearbyShowsShelf", () => {
  it("names the headliner rather than the event", () => {
    renderShelf([show()]);
    expect(screen.getByText("Bar Italia")).toBeInTheDocument();
  });

  it("falls back to the event name when no performer is listed", () => {
    renderShelf([show({ performers: [] })]);
    expect(screen.getByText("Show at Plan B")).toBeInTheDocument();
  });

  it("shows the venue and date together", () => {
    renderShelf([show()]);
    expect(screen.getByText(/Plan B ·/)).toBeInTheDocument();
  });

  it("uses the event's own image when JamBase gave one", () => {
    renderShelf([
      show({ imageUrl: "https://img.test/event.jpg", artistImageUrl: null }),
    ]);

    expect(screen.getByAltText("Bar Italia")).toHaveAttribute(
      "src",
      "https://img.test/event.jpg"
    );
  });

  it("falls back to the headliner photo when the event has no image", () => {
    renderShelf([show({ artistImageUrl: "https://img.test/artist.jpg" })]);

    expect(screen.getByAltText("Bar Italia")).toHaveAttribute(
      "src",
      "https://img.test/artist.jpg"
    );
  });

  it("renders a placeholder rather than a broken image with neither", () => {
    renderShelf([show()]);
    expect(screen.queryByAltText("Bar Italia")).not.toBeInTheDocument();
  });

  it("links to a search for the headliner, so the music can be looked up", () => {
    renderShelf([show()]);

    expect(
      screen.getByRole("link", { name: "Search for Bar Italia" })
    ).toHaveAttribute("href", "/search?q=Bar+Italia");
  });

  it("links tickets externally", () => {
    renderShelf([show()]);

    const link = screen.getByRole("link", { name: "Tickets for Bar Italia" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("omits the ticket link when there is no ticket url", () => {
    renderShelf([show({ ticketUrl: null })]);
    expect(
      screen.queryByRole("link", { name: /Tickets for/ })
    ).not.toBeInTheDocument();
  });

  it("marks a followed artist", () => {
    renderShelf([show({ following: true })]);
    expect(screen.getByText("Following")).toBeInTheDocument();
  });

  it("shows no more than the tile fits", () => {
    const shows = [1, 2, 3, 4, 5, 6].map((n) =>
      show({ eventKey: `jambase:${n}` })
    );

    renderShelf(shows);

    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("offers a way to the full list only when there is more to see", () => {
    renderShelf([show()]);
    expect(
      screen.queryByRole("link", { name: "See all" })
    ).not.toBeInTheDocument();

    const shows = [1, 2, 3, 4, 5].map((n) =>
      show({ eventKey: `jambase:${n}` })
    );
    renderShelf(shows);
    expect(screen.getByRole("link", { name: "See all" })).toHaveAttribute(
      "href",
      "/library/live"
    );
  });
});
