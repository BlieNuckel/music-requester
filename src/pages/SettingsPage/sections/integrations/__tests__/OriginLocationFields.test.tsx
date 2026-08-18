import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OriginLocationFields from "../OriginLocationFields";

const mockGetCurrentPosition = vi.fn();
const mockFetch = vi.fn();

const MALMO = {
  name: "Malmö",
  region: "Skåne County",
  country: "Sweden",
  countryCode: "SE",
  latitude: 55.6059,
  longitude: 13.0007,
  population: 362133,
};

function renderFields(originLat: number | null = null, originLon = null) {
  const onChange = vi.fn();
  render(
    <OriginLocationFields
      originLat={originLat}
      originLon={originLon}
      onChange={onChange}
    />
  );
  return onChange;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", {
    geolocation: { getCurrentPosition: mockGetCurrentPosition },
  });
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ places: [MALMO] }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OriginLocationFields", () => {
  it("still lets the coordinates be typed by hand", () => {
    const onChange = renderFields();

    fireEvent.change(screen.getByLabelText("Origin latitude"), {
      target: { value: "55.6" },
    });

    expect(onChange).toHaveBeenLastCalledWith({ originLat: 55.6 });
  });

  it("empties a coordinate rather than sending NaN", async () => {
    const onChange = renderFields(55.6);

    await userEvent.clear(screen.getByLabelText("Origin latitude"));

    expect(onChange).toHaveBeenLastCalledWith({ originLat: null });
  });

  it("fills both coordinates from the browser's location", async () => {
    mockGetCurrentPosition.mockImplementation((onSuccess) =>
      onSuccess({ coords: { latitude: 55.60587, longitude: 13.00073 } })
    );
    const onChange = renderFields();

    await userEvent.click(
      screen.getByRole("button", { name: "Use my location" })
    );

    expect(onChange).toHaveBeenCalledWith({
      originLat: 55.6059,
      originLon: 13.0007,
    });
  });

  it("explains a refused location instead of doing nothing", async () => {
    mockGetCurrentPosition.mockImplementation((_onSuccess, onError) =>
      onError({ code: 1 })
    );
    renderFields();

    await userEvent.click(
      screen.getByRole("button", { name: "Use my location" })
    );

    expect(
      await screen.findByText(/Location permission was denied/)
    ).toBeInTheDocument();
  });

  it("looks a city up and fills both coordinates from the pick", async () => {
    const onChange = renderFields();

    await userEvent.type(screen.getByLabelText("Search a city"), "Malmö");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Malmö, Skåne County, Sweden",
      })
    );

    expect(onChange).toHaveBeenCalledWith({
      originLat: 55.6059,
      originLon: 13.0007,
    });
  });

  it("searches on Enter as well as the button", async () => {
    renderFields();

    await userEvent.type(
      screen.getByLabelText("Search a city"),
      "Malmö{Enter}"
    );

    expect(mockFetch).toHaveBeenCalledWith("/api/live/geocode?q=Malm%C3%B6");
  });

  it("says when nothing matched rather than showing an empty list", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ places: [] }),
    });
    renderFields();

    await userEvent.type(
      screen.getByLabelText("Search a city"),
      "Nowherecity{Enter}"
    );

    expect(
      await screen.findByText("No place matched that.")
    ).toBeInTheDocument();
  });

  it("surfaces a failed lookup", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    renderFields();

    await userEvent.type(
      screen.getByLabelText("Search a city"),
      "Malmö{Enter}"
    );

    expect(
      await screen.findByText("Could not look that place up.")
    ).toBeInTheDocument();
  });

  it("closes the result list once a place is picked", async () => {
    renderFields();

    await userEvent.type(
      screen.getByLabelText("Search a city"),
      "Malmö{Enter}"
    );
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Malmö, Skåne County, Sweden",
      })
    );

    expect(
      screen.queryByRole("button", { name: "Malmö, Skåne County, Sweden" })
    ).not.toBeInTheDocument();
  });
});
