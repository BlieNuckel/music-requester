import { render, screen } from "@testing-library/react";
import RecommenderGraphCanvas from "../RecommenderGraphCanvas";
import { RecommenderParamsContext } from "../paramsContext";
import { DEFAULT_PROMOTED_ALBUM } from "@/context/promotedAlbumDefaults";
import { makeGraph, makeNode } from "./fixtures";
import { ThemeContext } from "@/context/themeContextDef";
import type { ActualTheme } from "@/context/themeContextDef";
import type { LayoutOptions } from "../autoLayout";

const graph = makeGraph(
  [
    makeNode({ id: "a", flow: "spotlight", spendsBudget: true }),
    makeNode({ id: "b", flow: "spotlight", title: "One-hit discount" }),
    makeNode({
      id: "profileDocument",
      flow: "profile",
      title: "Stored profile",
    }),
  ],
  [
    { id: "a->b", from: "a", to: "b", kind: "data" },
    {
      id: "profileDocument->a",
      from: "profileDocument",
      to: "a",
      kind: "data",
    },
  ]
);

function renderCanvas(
  actualTheme: ActualTheme = "light",
  layout: LayoutOptions = { direction: "LR", spacing: "comfortable" }
) {
  return render(
    <ThemeContext.Provider
      value={{
        theme: actualTheme,
        actualTheme,
        setTheme: vi.fn(),
        isLoading: false,
      }}
    >
      <RecommenderParamsContext.Provider
        value={{
          config: DEFAULT_PROMOTED_ALBUM,
          update: vi.fn(),
          openFlow: vi.fn(),
          arrivedAt: null,
        }}
      >
        <RecommenderGraphCanvas
          graph={graph}
          flow="spotlight"
          layout={layout}
        />
      </RecommenderParamsContext.Provider>
    </ThemeContext.Provider>
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

  it("introduces the flow it is showing", () => {
    renderCanvas();

    expect(
      screen.getByText(/how one set of album recommendations is picked/i)
    ).toBeInTheDocument();
  });

  it("draws a node from another flow as a boundary reference", () => {
    renderCanvas();

    expect(screen.getByText("Stored profile")).toBeInTheDocument();
    expect(screen.getByText("Open that flow")).toBeInTheDocument();
  });

  it("follows the app's theme rather than staying light", () => {
    const { container } = renderCanvas("dark");

    expect(container.querySelector(".react-flow.dark")).toBeInTheDocument();
  });

  it("moves the connectors to the facing sides when the flow runs downwards", () => {
    const { container } = renderCanvas("light", {
      direction: "TB",
      spacing: "comfortable",
    });

    expect(
      container.querySelector(".react-flow__handle-bottom")
    ).toBeInTheDocument();
    expect(
      container.querySelector(".react-flow__handle-left")
    ).not.toBeInTheDocument();
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
