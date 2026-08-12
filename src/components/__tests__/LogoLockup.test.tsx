import { render, screen } from "@testing-library/react";
import LogoLockup from "../LogoLockup";

describe("LogoLockup", () => {
  it("renders the mark and the wordmark", () => {
    render(<LogoLockup />);

    expect(screen.getByRole("img", { name: "Tunearr" })).toBeInTheDocument();
    expect(screen.getByText("Tunearr")).toBeVisible();
  });

  it("scales the mark with the requested size", () => {
    const { rerender } = render(<LogoLockup size="sm" />);
    expect(screen.getByRole("img", { name: "Tunearr" })).toHaveClass("w-7");

    rerender(<LogoLockup size="lg" />);
    expect(screen.getByRole("img", { name: "Tunearr" })).toHaveClass("w-10");
  });

  it("passes responsive classes to the wordmark so it can be hidden", () => {
    const { container } = render(
      <LogoLockup wordmarkClassName="hidden sm:inline-block" />
    );

    expect(container.querySelector(".hidden.sm\\:inline-block")).not.toBeNull();
  });

  it("keeps the underline out of the accessibility tree", () => {
    const { container } = render(<LogoLockup />);

    const underline = container.querySelector('svg[aria-hidden="true"]');
    expect(underline).not.toBeNull();
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });
});
