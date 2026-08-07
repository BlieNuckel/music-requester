import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReleaseSectionGrid from "../ReleaseSectionGrid";
import type { ReleaseGroup } from "@/types";

vi.mock("@/components/ReleaseGroupCard", () => ({
  default: ({
    releaseGroup,
    inLibrary,
  }: {
    releaseGroup: ReleaseGroup;
    inLibrary?: boolean;
  }) => (
    <div data-testid={`rg-${releaseGroup.id}`} data-in-library={inLibrary}>
      {releaseGroup.title}
    </div>
  ),
}));

const makeRg = (overrides: Partial<ReleaseGroup>): ReleaseGroup => ({
  id: "rg",
  score: 100,
  title: "Title",
  "primary-type": "Album",
  "first-release-date": "2020-01-01",
  "artist-credit": [{ name: "Artist", artist: { id: "a1", name: "Artist" } }],
  ...overrides,
});

const items = [
  makeRg({ id: "one", title: "First Album" }),
  makeRg({ id: "two", title: "Second Album" }),
];

describe("ReleaseSectionGrid", () => {
  it("renders expanded when defaultExpanded is set", () => {
    render(<ReleaseSectionGrid title="Albums" items={items} defaultExpanded />);

    const toggle = screen.getByRole("button", { name: /Albums\s*\(2\)/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("First Album")).toBeInTheDocument();
  });

  it("renders collapsed by default with title and item count", () => {
    render(<ReleaseSectionGrid title="Albums" items={items} />);

    const toggle = screen.getByRole("button", { name: /Albums\s*\(2\)/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("First Album")).not.toBeInTheDocument();
    expect(screen.queryByText("Second Album")).not.toBeInTheDocument();
  });

  it("expands on title click and shows the items", async () => {
    const user = userEvent.setup();
    render(<ReleaseSectionGrid title="Albums" items={items} />);

    await user.click(screen.getByRole("button", { name: /Albums\s*\(2\)/ }));

    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("First Album")).toBeInTheDocument();
    expect(screen.getByText("Second Album")).toBeInTheDocument();
  });

  it("collapses again on a second click", async () => {
    const user = userEvent.setup();
    render(<ReleaseSectionGrid title="Albums" items={items} />);

    const toggle = screen.getByRole("button", { name: /Albums\s*\(2\)/ });
    await user.click(toggle);
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("First Album")).not.toBeInTheDocument();
  });

  it("passes per-album library status to the cards", () => {
    render(
      <ReleaseSectionGrid
        title="Albums"
        items={items}
        defaultExpanded
        isAlbumInLibrary={(mbid) => mbid === "one"}
      />
    );

    expect(screen.getByTestId("rg-one")).toHaveAttribute(
      "data-in-library",
      "true"
    );
    expect(screen.getByTestId("rg-two")).toHaveAttribute(
      "data-in-library",
      "false"
    );
  });

  it("rotates the chevron when expanded", async () => {
    const user = userEvent.setup();
    render(<ReleaseSectionGrid title="Albums" items={items} />);

    const toggle = screen.getByRole("button", { name: /Albums\s*\(2\)/ });
    const chevron = toggle.querySelector("svg");
    expect(chevron).not.toHaveClass("rotate-90");

    await user.click(toggle);
    expect(chevron).toHaveClass("rotate-90");
  });
});
