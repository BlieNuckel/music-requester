import { render, screen } from "@testing-library/react";
import RecommenderGraphCanvas from "../RecommenderGraphCanvas";
import { RecommenderParamsContext } from "../paramsContext";
import { DEFAULT_PROMOTED_ALBUM } from "@/context/promotedAlbumDefaults";
import { makeGraph, makeNode } from "./fixtures";

const graph = makeGraph(
  [makeNode({ id: "a" }), makeNode({ id: "b", title: "One-hit discount" })],
  [{ id: "a->b", from: "a", to: "b", kind: "data" }]
);

function renderCanvas() {
  render(
    <RecommenderParamsContext.Provider
      value={{ config: DEFAULT_PROMOTED_ALBUM, update: vi.fn() }}
    >
      <RecommenderGraphCanvas graph={graph} layout="authored" />
    </RecommenderParamsContext.Provider>
  );
}

describe("RecommenderGraphCanvas", () => {
  it("mounts the canvas", () => {
    renderCanvas();

    expect(screen.getByTestId("recommender-canvas")).toBeInTheDocument();
  });

  it("renders each node as a card", () => {
    renderCanvas();

    expect(screen.getByText("One-hit discount")).toBeInTheDocument();
  });

  it("explains what the edge kinds mean", () => {
    renderCanvas();

    expect(screen.getByText("falls back to")).toBeInTheDocument();
    expect(
      screen.getByText(/tried in order, and only until one answers/i)
    ).toBeInTheDocument();
  });

  it("shows the shared lookup budget as a resource rather than a step", () => {
    renderCanvas();

    expect(
      screen.getByText(
        /30 musicbrainz lookups per build, shared by every source/i
      )
    ).toBeInTheDocument();
  });
});
