import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import LiveBanner from "../LiveBanner";
import type { LiveNotice } from "@/types";

function notice(overrides: Partial<LiveNotice> = {}): LiveNotice {
  return {
    id: 1,
    eventKey: "jambase:100",
    name: "Yves Tumor at Amiralen",
    eventDate: "2026-08-30",
    previousStartDate: null,
    status: "scheduled",
    statusChangedAt: null,
    venueName: "Amiralen",
    venueCity: "Malmö",
    venueCountry: "SE",
    ticketUrl: "https://tickets.test/100",
    imageUrl: null,
    distanceKm: 2.4,
    performers: [
      { jambaseId: "jambase:1", name: "Yves Tumor", isHeadliner: true },
      { jambaseId: "jambase:2", name: "Support", isHeadliner: false },
    ],
    response: null,
    viewedAt: null,
    tier: "local",
    reason: "coming-up",
    ...overrides,
  };
}

function renderBanner(
  overrides: Partial<LiveNotice> = {},
  additionalCount = 0,
  onRespond = vi.fn()
) {
  render(
    <MemoryRouter>
      <LiveBanner
        notice={notice(overrides)}
        additionalCount={additionalCount}
        onRespond={onRespond}
      />
    </MemoryRouter>
  );
  return onRespond;
}

describe("LiveBanner", () => {
  it("leads with the headliner rather than the event title", () => {
    renderBanner();
    expect(
      screen.getByText("Yves Tumor is playing near you")
    ).toBeInTheDocument();
  });

  it("shows venue, date, and distance for a local show", () => {
    renderBanner();
    const details = screen.getByText(/Amiralen, Malmö/);
    expect(details).toHaveTextContent("2 km");
  });

  it("changes the wording for a show that needs travelling to", () => {
    renderBanner({
      tier: "regional",
      venueCity: "Berlin",
      venueCountry: "DE",
      venueName: "Berghain",
      distanceKm: 350,
    });

    expect(
      screen.getByText("Yves Tumor is playing within reach")
    ).toBeInTheDocument();
    expect(screen.getByText(/Berghain, Berlin, DE/)).toBeInTheDocument();
    expect(screen.queryByText(/350 km/)).not.toBeInTheDocument();
  });

  it.each([
    ["cancelled", "Cancelled"],
    ["postponed", "Postponed"],
    ["rescheduled", "Rescheduled"],
  ] as const)("renders the %s status as a pill", (status, label) => {
    renderBanner({ status, reason: "status-changed" });

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(`Yves Tumor: ${label}`)).toBeInTheDocument();
  });

  it("says where a rescheduled show moved from", () => {
    renderBanner({
      status: "rescheduled",
      previousStartDate: "2026-07-01",
      reason: "status-changed",
    });
    expect(screen.getByText(/Moved from/)).toBeInTheDocument();
  });

  it("shows no status pill for a normal show", () => {
    renderBanner();
    expect(screen.queryByText("Cancelled")).not.toBeInTheDocument();
  });

  it("opens tickets externally without hijacking the card", () => {
    renderBanner();
    const link = screen.getByRole("link", { name: "Tickets" });

    expect(link).toHaveAttribute("href", "https://tickets.test/100");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("omits the ticket link when there is no url", () => {
    renderBanner({ ticketUrl: null });
    expect(
      screen.queryByRole("link", { name: "Tickets" })
    ).not.toBeInTheDocument();
  });

  it("links to the full list only when there is more to see", () => {
    renderBanner({}, 2);
    expect(screen.getByRole("link", { name: "2 more →" })).toHaveAttribute(
      "href",
      "/library/live"
    );
  });

  it("hides the overflow link at zero", () => {
    renderBanner({}, 0);
    expect(screen.queryByText(/more →/)).not.toBeInTheDocument();
  });

  it("reports going", async () => {
    const onRespond = renderBanner();
    await userEvent.click(screen.getByRole("button", { name: "Going" }));
    expect(onRespond).toHaveBeenCalledWith(1, "going");
  });

  it("reports a dismissal", async () => {
    const onRespond = renderBanner();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onRespond).toHaveBeenCalledWith(1, "dismissed");
  });

  it("falls back to the event name when nobody is flagged as headliner", () => {
    renderBanner({
      performers: [
        { jambaseId: "jambase:9", name: "Someone", isHeadliner: false },
      ],
    });
    expect(screen.getByText("Someone is playing near you")).toBeInTheDocument();
  });

  it("survives an empty lineup", () => {
    renderBanner({ performers: [] });
    expect(
      screen.getByText("Yves Tumor at Amiralen is playing near you")
    ).toBeInTheDocument();
  });
});
