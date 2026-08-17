import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import LiveBannerSection from "../LiveBannerSection";
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
    ticketUrl: null,
    imageUrl: null,
    distanceKm: 2.4,
    performers: [
      { jambaseId: "jambase:1", name: "Yves Tumor", isHeadliner: true },
    ],
    response: null,
    viewedAt: null,
    tier: "local",
    reason: "coming-up",
    ...overrides,
  };
}

function mockFetch(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderSection() {
  const onStatusChange = vi.fn();
  render(
    <MemoryRouter>
      <LiveBannerSection onStatusChange={onStatusChange} />
    </MemoryRouter>
  );
  return onStatusChange;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("LiveBannerSection", () => {
  it("renders the notice once it arrives and reports ready", async () => {
    mockFetch({ notice: notice(), additionalCount: 0 });
    const onStatusChange = renderSection();

    expect(await screen.findByText(/is playing near you/)).toBeInTheDocument();
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith("ready"));
  });

  it("reports empty so the grid hides the tile when there is no notice", async () => {
    mockFetch({ notice: null, additionalCount: 0 });
    const onStatusChange = renderSection();

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith("empty"));
    expect(screen.queryByText(/is playing/)).not.toBeInTheDocument();
  });

  it("reports loading first", () => {
    mockFetch({ notice: null, additionalCount: 0 });
    const onStatusChange = renderSection();

    expect(onStatusChange).toHaveBeenCalledWith("loading");
  });

  it("reports error when the request fails", async () => {
    mockFetch(null, false);
    const onStatusChange = renderSection();

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith("error"));
  });

  it("renders nothing at all while empty, not a skeleton", async () => {
    mockFetch({ notice: null, additionalCount: 0 });
    const { container } = render(
      <MemoryRouter>
        <LiveBannerSection onStatusChange={vi.fn()} />
      </MemoryRouter>
    );

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("posts a response and clears the banner", async () => {
    const fetchMock = mockFetch({ notice: notice(), additionalCount: 0 });
    renderSection();

    await screen.findByText(/is playing near you/);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/live/events/1/response",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ response: "dismissed" }),
        })
      );
    });
  });

  it("passes the overflow count through", async () => {
    mockFetch({ notice: notice(), additionalCount: 3 });
    renderSection();

    expect(await screen.findByText("3 more →")).toBeInTheDocument();
  });
});
