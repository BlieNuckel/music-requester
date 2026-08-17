import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LiveList from "../LiveList";
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
    venueName: "Amiralen",
    venueCity: "Malmö",
    venueCountry: "SE",
    ticketUrl: "https://tickets.test/100",
    imageUrl: null,
    distanceKm: null,
    performers: [
      { jambaseId: "jambase:1", name: "Yves Tumor", isHeadliner: true },
    ],
    response: null,
    viewedAt: null,
    ...overrides,
  };
}

function mockFetch(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function lastUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  const calls = fetchMock.mock.calls;
  return calls[calls.length - 1]?.[0] as string;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("LiveList", () => {
  it("opens on upcoming and lists what it gets", async () => {
    const fetchMock = mockFetch({ events: [event()] });
    render(<LiveList />);

    expect(await screen.findByText("Yves Tumor")).toBeInTheDocument();
    expect(lastUrl(fetchMock)).toBe("/api/live/events");
  });

  it("switches filters and requests the right query", async () => {
    const fetchMock = mockFetch({ events: [] });
    render(<LiveList />);

    await userEvent.click(screen.getByRole("button", { name: "Going" }));
    await waitFor(() =>
      expect(lastUrl(fetchMock)).toBe("/api/live/events?response=going")
    );

    await userEvent.click(screen.getByRole("button", { name: "Dismissed" }));
    await waitFor(() =>
      expect(lastUrl(fetchMock)).toBe("/api/live/events?response=dismissed")
    );

    await userEvent.click(screen.getByRole("button", { name: "Past" }));
    await waitFor(() =>
      expect(lastUrl(fetchMock)).toBe("/api/live/events?past=true")
    );
  });

  it("marks the active filter for assistive tech", async () => {
    mockFetch({ events: [] });
    render(<LiveList />);

    expect(screen.getByRole("button", { name: "Upcoming" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await userEvent.click(screen.getByRole("button", { name: "Past" }));
    expect(screen.getByRole("button", { name: "Past" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("gives each filter its own empty message", async () => {
    mockFetch({ events: [] });
    render(<LiveList />);

    expect(
      await screen.findByText("No upcoming dates for artists you follow")
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Going" }));
    expect(
      await screen.findByText("You haven't marked any shows as going")
    ).toBeInTheDocument();
  });

  it("badges a going response and a changed status", async () => {
    mockFetch({
      events: [event({ response: "going", status: "cancelled" })],
    });
    render(<LiveList />);

    expect(await screen.findByText("Going")).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });

  it("does not offer tickets for a show that already happened", async () => {
    mockFetch({ events: [event()] });
    render(<LiveList />);

    await screen.findByText("Yves Tumor");
    expect(screen.getByRole("link", { name: "Tickets" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Past" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "Tickets" })
      ).not.toBeInTheDocument()
    );
  });

  it("surfaces a load failure", async () => {
    mockFetch(null, false);
    render(<LiveList />);

    expect(
      await screen.findByText("Could not load live dates")
    ).toBeInTheDocument();
  });
});
