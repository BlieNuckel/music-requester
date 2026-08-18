import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import LiveRosterStatus from "../LiveRosterStatus";

const mockFetch = vi.fn();

function respond(body: unknown) {
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LiveRosterStatus", () => {
  it("counts the roster by resolution state", async () => {
    respond({ tracked: 12, pending: 3, unavailable: 1 });

    render(<LiveRosterStatus enabled />);

    expect(
      await screen.findByText("12 tracked, 3 pending, 1 unavailable")
    ).toBeInTheDocument();
  });

  it("explains the unavailable count, which is the interesting one", async () => {
    respond({ tracked: 12, pending: 0, unavailable: 2 });

    render(<LiveRosterStatus enabled />);

    expect(
      await screen.findByText(/no listing for 2 followed artists/)
    ).toBeInTheDocument();
  });

  it("says artist rather than artists for a single miss", async () => {
    respond({ tracked: 1, pending: 0, unavailable: 1 });

    render(<LiveRosterStatus enabled />);

    expect(
      await screen.findByText(/no listing for 1 followed artist,/)
    ).toBeInTheDocument();
  });

  it("stays quiet when nothing is unavailable", async () => {
    respond({ tracked: 4, pending: 0, unavailable: 0 });

    render(<LiveRosterStatus enabled />);

    await screen.findByText("4 tracked, 0 pending, 0 unavailable");
    expect(screen.queryByText(/no listing for/)).not.toBeInTheDocument();
  });

  it("renders nothing for an empty roster", async () => {
    respond({ tracked: 0, pending: 0, unavailable: 0 });

    const { container } = render(<LiveRosterStatus enabled />);

    expect(container).toBeEmptyDOMElement();
  });

  it("does not ask when live events are switched off", () => {
    render(<LiveRosterStatus enabled={false} />);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
