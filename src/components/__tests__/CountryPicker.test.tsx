import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CountryPicker from "../CountryPicker";

/** Controlled for real, so a test that adds twice sees the first add. */
function renderPicker(initial: string[] = []) {
  const onChange = vi.fn();

  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <CountryPicker
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }

  render(<Harness />);
  return { onChange, input: screen.getByRole("combobox") };
}

describe("CountryPicker", () => {
  it("shows a chosen code with its country name", () => {
    renderPicker(["SE"]);
    expect(screen.getByText("SE")).toBeInTheDocument();
    expect(screen.getByText("Sweden")).toBeInTheDocument();
  });

  it("suggests countries by name as you type", async () => {
    const { input } = renderPicker();
    await userEvent.type(input, "denm");

    expect(screen.getByRole("option", { name: /Denmark/ })).toBeInTheDocument();
  });

  it("adds the country you pick from the list", async () => {
    const { onChange, input } = renderPicker(["SE"]);
    await userEvent.type(input, "denm");
    await userEvent.click(screen.getByRole("option", { name: /Denmark/ }));

    expect(onChange).toHaveBeenCalledWith(["SE", "DK"]);
  });

  it("adds the highlighted suggestion on Enter", async () => {
    const { onChange, input } = renderPicker();
    await userEvent.type(input, "germ{Enter}");

    expect(onChange).toHaveBeenCalledWith(["DE"]);
  });

  it("takes a typed code as well as a name", async () => {
    const { onChange, input } = renderPicker();
    await userEvent.type(input, "no{Enter}");

    expect(onChange).toHaveBeenCalledWith(["NO"]);
  });

  it("commits on a comma, so a pasted list is not one long string", async () => {
    const { onChange, input } = renderPicker();
    await userEvent.type(input, "se, dk, de,");

    expect(onChange).toHaveBeenLastCalledWith(["SE", "DK", "DE"]);
  });

  it("accepts a whole list at once", async () => {
    const { onChange, input } = renderPicker();
    await userEvent.type(input, "SE DK NO,");

    expect(onChange).toHaveBeenLastCalledWith(["SE", "DK", "NO"]);
  });

  it("swaps UK for GB and says why", async () => {
    const { onChange, input } = renderPicker();
    await userEvent.type(input, "UK{Enter}");

    expect(onChange).toHaveBeenCalledWith(["GB"]);
    expect(screen.getByText(/added GB/)).toBeInTheDocument();
  });

  it("falls back to the best match for something that is not a code", async () => {
    const { onChange, input } = renderPicker();
    await userEvent.type(input, "SWE{Enter}");

    expect(onChange).toHaveBeenCalledWith(["SE"]);
  });

  it("explains a query that matches nothing at all", async () => {
    const { onChange, input } = renderPicker();
    await userEvent.type(input, "QQQ{Enter}");

    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByText(/is not a two-letter country code/)
    ).toBeInTheDocument();
  });

  it("ignores a country that is already chosen", async () => {
    const { onChange, input } = renderPicker(["SE"]);
    await userEvent.type(input, "SE{Enter}");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes a country from its pill", async () => {
    const { onChange } = renderPicker(["SE", "DK"]);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Sweden" })
    );

    expect(onChange).toHaveBeenCalledWith(["DK"]);
  });

  it("removes the last country on backspace in an empty input", async () => {
    const { onChange, input } = renderPicker(["SE", "DK"]);
    await userEvent.type(input, "{Backspace}");

    expect(onChange).toHaveBeenCalledWith(["SE"]);
  });

  it("flags a code that was already saved but the API will reject", () => {
    renderPicker(["UK"]);
    expect(screen.getByText(/GB rather than UK/)).toBeInTheDocument();
  });

  it("moves the highlight with the arrow keys", async () => {
    const { input } = renderPicker();
    await userEvent.type(input, "den");

    const before = screen.getAllByRole("option");
    expect(before[0]).toHaveAttribute("aria-selected", "true");

    await userEvent.type(input, "{ArrowDown}");

    const after = screen.getAllByRole("option");
    expect(after[0]).toHaveAttribute("aria-selected", "false");
    expect(after[1]).toHaveAttribute("aria-selected", "true");
  });

  it("adds the country the arrow keys landed on", async () => {
    const { onChange, input } = renderPicker();
    await userEvent.type(input, "den");

    const second = screen.getAllByRole("option")[1].textContent;
    await userEvent.type(input, "{ArrowDown}{Enter}");

    expect(second).toContain(onChange.mock.calls[0][0][0]);
  });
});
