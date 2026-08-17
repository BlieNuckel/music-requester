import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LiveEventsSection from "../LiveEventsSection";
import { DEFAULT_LIVE_EVENTS } from "@shared/settingsDefaults";

function renderSection(overrides = {}) {
  const onChange = vi.fn();
  render(
    <LiveEventsSection
      settings={{ ...DEFAULT_LIVE_EVENTS, ...overrides }}
      onChange={onChange}
    />
  );
  return onChange;
}

describe("LiveEventsSection", () => {
  it("warns that overage is billed rather than refused", () => {
    renderSection();
    expect(screen.getByText(/billed rather than refused/)).toBeInTheDocument();
  });

  it("keeps the API key masked", () => {
    renderSection({ apiKey: "jbd_secret" });
    expect(screen.getByDisplayValue("jbd_secret")).toHaveAttribute(
      "type",
      "password"
    );
  });

  it("parses a comma-separated country list", () => {
    const onChange = renderSection();

    const input = screen.getByPlaceholderText("SE, DK, DE");
    fireEvent.change(input, { target: { value: "se, dk , de" } });

    expect(onChange).toHaveBeenLastCalledWith({ regions: ["SE", "DK", "DE"] });
  });

  it("rejects UK with an explanation rather than silently failing later", () => {
    renderSection({ regions: ["UK"] });
    expect(screen.getByText(/Use GB rather than UK/)).toBeInTheDocument();
  });

  it("flags a code that is not alpha-2", () => {
    renderSection({ regions: ["SWE"] });
    expect(
      screen.getByText(/is not a two-letter country code/)
    ).toBeInTheDocument();
  });

  it("explains that the radius bounds everyone on the instance", () => {
    renderSection();
    expect(
      screen.getByText(/nobody can see shows beyond it/)
    ).toBeInTheDocument();
  });

  it("empties the origin fields rather than sending NaN", async () => {
    const onChange = renderSection({ originLat: 55.6 });

    const input = screen.getByDisplayValue("55.6");
    await userEvent.clear(input);

    expect(onChange).toHaveBeenLastCalledWith({ originLat: null });
  });

  it("toggles the feature", async () => {
    const onChange = renderSection();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith({ enabled: true });
  });
});
