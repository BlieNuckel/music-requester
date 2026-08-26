import { render } from "@testing-library/react";
import RecommenderGraphCanvas from "../RecommenderGraphCanvas";
import { RecommenderParamsContext } from "../paramsContext";
import { DEFAULT_PROMOTED_ALBUM } from "@/context/promotedAlbumDefaults";
import { makeGraph, makeNode } from "./fixtures";
import { ThemeContext } from "@/context/themeContextDef";

/**
 * jsdom's ResizeObserver is a stub, so nothing is ever measured and the settle effect would
 * not run at all. Initialization is forced, and `fitView` is captured, because where the
 * viewport ends up is the only thing that says a reference was followed.
 */
const { fitView } = vi.hoisted(() => ({ fitView: vi.fn() }));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    useNodesInitialized: () => true,
    useReactFlow: () => ({ ...actual.useReactFlow(), fitView }),
  };
});

const graph = makeGraph(
  [
    makeNode({ id: "a", flow: "spotlight" }),
    makeNode({ id: "b", flow: "spotlight", title: "Library side" }),
  ],
  [{ id: "a->b", from: "a", to: "b", kind: "data" }]
);

function renderAt(arrivedAt: string | null) {
  return render(
    <ThemeContext.Provider
      value={{
        theme: "light",
        actualTheme: "light",
        setTheme: vi.fn(),
        isLoading: false,
      }}
    >
      <RecommenderParamsContext.Provider
        value={{
          config: DEFAULT_PROMOTED_ALBUM,
          update: vi.fn(),
          openFlow: vi.fn(),
          arrivedAt,
        }}
      >
        <RecommenderGraphCanvas
          graph={graph}
          flow="spotlight"
          layout={{ direction: "LR", spacing: "comfortable" }}
        />
      </RecommenderParamsContext.Provider>
    </ThemeContext.Provider>
  );
}

describe("following a reference", () => {
  beforeEach(() => fitView.mockClear());

  it("lands on the node arrived at rather than on the whole chart", () => {
    renderAt("b");

    expect(fitView).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: [{ id: "b" }] })
    );
  });

  it("fits the whole chart when the flow was opened from the toolbar", () => {
    renderAt(null);

    expect(fitView).toHaveBeenCalledWith(undefined);
  });

  /**
   * Over half the references a card offers name a step in the flow already on screen, which
   * remounts nothing. Latching the landing to the one-shot layout left those going nowhere.
   */
  it("lands again when the reference followed was in this flow all along", () => {
    const { rerender } = renderAt("a");
    fitView.mockClear();

    rerender(
      <ThemeContext.Provider
        value={{
          theme: "light",
          actualTheme: "light",
          setTheme: vi.fn(),
          isLoading: false,
        }}
      >
        <RecommenderParamsContext.Provider
          value={{
            config: DEFAULT_PROMOTED_ALBUM,
            update: vi.fn(),
            openFlow: vi.fn(),
            arrivedAt: "b",
          }}
        >
          <RecommenderGraphCanvas
            graph={graph}
            flow="spotlight"
            layout={{ direction: "LR", spacing: "comfortable" }}
          />
        </RecommenderParamsContext.Provider>
      </ThemeContext.Provider>
    );

    expect(fitView).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: [{ id: "b" }] })
    );
  });
});
