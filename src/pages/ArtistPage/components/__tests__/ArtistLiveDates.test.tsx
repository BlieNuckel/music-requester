import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ArtistLiveDates from "../ArtistLiveDates";
import type { LiveEventSummary } from "@/types";

function event(overrides: Partial<LiveEventSummary> = {}): LiveEventSummary {
  return {
    id: 1,
    eventKey: "jambase:100",
    name: "Show",
    eventDate: "2026-09-05",
    previousStartDate: null,
    status: "scheduled",
    statusChangedAt: null,
    venueName: "Berghain",
    venueCity: "Berlin",
    venueCountry: "DE",
    ticketUrl: "https://tickets.test/100",
    imageUrl: null,
    distanceKm: null,
    performers: [],
    response: null,
    viewedAt: null,
    ...overrides,
  };
}

describe("ArtistLiveDates", () => {
  it("renders nothing when the artist has no dates", () => {
    const { container } = render(<ArtistLiveDates dates={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists dates with their venue, wherever in the world they are", () => {
    render(<ArtistLiveDates dates={[event()]} />);

    expect(screen.getByText("Live dates")).toBeInTheDocument();
    expect(screen.getByText("Berghain, Berlin, DE")).toBeInTheDocument();
  });

  it("shows a status pill for a changed show", () => {
    render(<ArtistLiveDates dates={[event({ status: "postponed" })]} />);
    expect(screen.getByText("Postponed")).toBeInTheDocument();
  });

  it("links tickets externally", () => {
    render(<ArtistLiveDates dates={[event()]} />);

    const link = screen.getByRole("link", { name: "Tickets" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("omits the ticket link when there is none", () => {
    render(<ArtistLiveDates dates={[event({ ticketUrl: null })]} />);
    expect(
      screen.queryByRole("link", { name: "Tickets" })
    ).not.toBeInTheDocument();
  });

  it("renders every date it is given", () => {
    render(
      <ArtistLiveDates
        dates={[
          event({ eventKey: "a" }),
          event({ eventKey: "b", eventDate: "2026-10-01" }),
        ]}
      />
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
