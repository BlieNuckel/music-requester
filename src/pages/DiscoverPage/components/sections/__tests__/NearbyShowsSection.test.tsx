import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NearbyShowsSection from "../NearbyShowsSection";
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
    ...overrides,
  };
}

function mockFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, json: async () => body })
  );
}

function renderSection() {
  const onStatusChange = vi.fn();
  render(
    <MemoryRouter>
      <NearbyShowsSection onStatusChange={onStatusChange} />
    </MemoryRouter>
  );
  return onStatusChange;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("NearbyShowsSection", () => {
  it("lists shows in the order the server ranked them", async () => {
    mockFetch({
      events: [
        show({
          eventKey: "a",
          performers: [{ jambaseId: "1", name: "First", isHeadliner: true }],
        }),
        show({
          eventKey: "b",
          performers: [{ jambaseId: "2", name: "Second", isHeadliner: true }],
        }),
      ],
    });
    renderSection();

    const items = await screen.findAllByRole("listitem");
    expect(items[0]).toHaveTextContent("First");
    expect(items[1]).toHaveTextContent("Second");
  });

  it("caps the list so it cannot stretch the grid row it shares", async () => {
    mockFetch({
      events: Array.from({ length: 8 }, (_, i) =>
        show({
          eventKey: `e${i}`,
          performers: [
            { jambaseId: `${i}`, name: `Artist ${i}`, isHeadliner: true },
          ],
        })
      ),
    });
    renderSection();

    expect(await screen.findAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "See all" })).toHaveAttribute(
      "href",
      "/library/live"
    );
  });

  it("omits See all when everything already fits", async () => {
    mockFetch({ events: [show()] });
    renderSection();

    await screen.findByText("Bar Italia");
    expect(
      screen.queryByRole("link", { name: "See all" })
    ).not.toBeInTheDocument();
  });

  it("badges a followed artist rather than hiding them", async () => {
    mockFetch({ events: [show({ following: true })] });
    renderSection();

    expect(await screen.findByText("Following")).toBeInTheDocument();
    expect(screen.getByText("Bar Italia")).toBeInTheDocument();
  });

  it("shows no badge for an artist you do not follow", async () => {
    mockFetch({ events: [show({ following: false })] });
    renderSection();

    await screen.findByText("Bar Italia");
    expect(screen.queryByText("Following")).not.toBeInTheDocument();
  });

  it("reports empty and renders nothing when the floor filtered everything", async () => {
    mockFetch({ events: [] });
    const onStatusChange = renderSection();

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith("empty"));
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("reports ready once shows arrive", async () => {
    mockFetch({ events: [show()] });
    const onStatusChange = renderSection();

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith("ready"));
  });

  it("reports error on a failed request", async () => {
    mockFetch(null, false);
    const onStatusChange = renderSection();

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith("error"));
  });

  it("links tickets externally", async () => {
    mockFetch({ events: [show()] });
    renderSection();

    const link = await screen.findByRole("link", { name: /Tickets/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("href", "https://tickets.test/100");
  });

  it("omits the ticket link when there is none", async () => {
    mockFetch({ events: [show({ ticketUrl: null })] });
    renderSection();

    await screen.findByText("Bar Italia");
    expect(
      screen.queryByRole("link", { name: /Tickets/ })
    ).not.toBeInTheDocument();
  });
});
