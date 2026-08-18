import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ArtistLiveDates from "../ArtistLiveDates";
import type { LiveEventSummary, LiveTrackingState } from "@/types";

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
  it("renders nothing for an artist nobody follows", () => {
    const { container } = render(
      <ArtistLiveDates dates={[]} tracking={null} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says an empty list is a real answer for a tracked artist", () => {
    render(<ArtistLiveDates dates={[]} tracking="tracked" />);
    expect(screen.getByText("No upcoming dates.")).toBeInTheDocument();
  });

  it("says resolution is still in progress rather than showing nothing", () => {
    render(<ArtistLiveDates dates={[]} tracking="pending" />);
    expect(screen.getByText(/Checking for live dates/)).toBeInTheDocument();
  });

  it("explains that an unavailable artist will never have dates here", () => {
    render(<ArtistLiveDates dates={[]} tracking="unavailable" />);

    expect(
      screen.getByText(/has no listing for this artist/)
    ).toBeInTheDocument();
    expect(screen.getByText(/gap in the data/)).toBeInTheDocument();
  });

  it("gives each state its own copy", () => {
    const seen = new Set<string>();

    for (const tracking of [
      "pending",
      "tracked",
      "unavailable",
    ] as LiveTrackingState[]) {
      const { container, unmount } = render(
        <ArtistLiveDates dates={[]} tracking={tracking} />
      );
      seen.add(container.textContent ?? "");
      unmount();
    }

    expect(seen.size).toBe(3);
  });

  it("shows no empty-state copy once there are dates", () => {
    render(<ArtistLiveDates dates={[event()]} tracking="tracked" />);
    expect(screen.queryByText("No upcoming dates.")).not.toBeInTheDocument();
  });

  it("lists dates with their venue, wherever in the world they are", () => {
    render(<ArtistLiveDates dates={[event()]} tracking="tracked" />);

    expect(screen.getByText("Live dates")).toBeInTheDocument();
    expect(screen.getByText("Berghain, Berlin, DE")).toBeInTheDocument();
  });

  it("shows a status pill for a changed show", () => {
    render(
      <ArtistLiveDates
        dates={[event({ status: "postponed" })]}
        tracking="tracked"
      />
    );
    expect(screen.getByText("Postponed")).toBeInTheDocument();
  });

  it("links tickets externally", () => {
    render(<ArtistLiveDates dates={[event()]} tracking="tracked" />);

    const link = screen.getByRole("link", { name: "Tickets" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("omits the ticket link when there is none", () => {
    render(
      <ArtistLiveDates
        dates={[event({ ticketUrl: null })]}
        tracking="tracked"
      />
    );
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
        tracking="tracked"
      />
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
