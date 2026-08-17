import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LivePreferencesSection from "../LivePreferencesSection";

function preferencesBody(overrides: Record<string, unknown> = {}) {
  return {
    preferences: {
      live_radius_km: null,
      live_lat: null,
      live_lon: null,
      live_regions: null,
      live_announce_days: null,
      live_imminent_days_local: null,
      live_imminent_days_regional: null,
      live_banner_enabled: null,
      ...overrides,
    },
    coverage: {
      originLat: 55.605,
      originLon: 13.0038,
      sweepRadiusKm: 150,
      regions: ["SE", "DK"],
      configured: true,
    },
  };
}

function mockFetch(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("LivePreferencesSection", () => {
  it("discloses what the instance actually covers", async () => {
    mockFetch(preferencesBody());
    render(<LivePreferencesSection />);

    expect(
      await screen.findByText(/This instance covers 150 km around/)
    ).toBeInTheDocument();
  });

  it("says so when no location has been configured", async () => {
    mockFetch({
      ...preferencesBody(),
      coverage: {
        originLat: null,
        originLon: null,
        sweepRadiusKm: 150,
        regions: [],
        configured: false,
      },
    });
    render(<LivePreferencesSection />);

    expect(
      await screen.findByText(/No location has been set for this instance/)
    ).toBeInTheDocument();
  });

  it("defaults the banner toggle to on when unset", async () => {
    mockFetch(preferencesBody());
    render(<LivePreferencesSection />);

    expect(await screen.findByRole("checkbox")).toBeChecked();
  });

  it("saves a banner toggle", async () => {
    const fetchMock = mockFetch(preferencesBody());
    render(<LivePreferencesSection />);

    await userEvent.click(await screen.findByRole("checkbox"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/live/preferences",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ bannerEnabled: false }),
        })
      )
    );
  });

  it("falls back to the instance countries when the user has none", async () => {
    mockFetch(preferencesBody());
    render(<LivePreferencesSection />);

    expect(await screen.findByDisplayValue("SE, DK")).toBeInTheDocument();
  });

  it("surfaces a rejected save", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => preferencesBody() })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Use GB rather than UK" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<LivePreferencesSection />);
    await userEvent.click(await screen.findByRole("checkbox"));

    expect(
      await screen.findByText("Use GB rather than UK")
    ).toBeInTheDocument();
  });

  it("caps the radius input at what the instance sweeps", async () => {
    mockFetch(preferencesBody());
    render(<LivePreferencesSection />);

    const radius = await screen.findByDisplayValue("150");
    expect(radius).toHaveAttribute("max", "150");
  });
});
