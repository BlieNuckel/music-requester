import { render, screen, fireEvent } from "@testing-library/react";
import RecommenderListView from "../RecommenderListView";
import { RecommenderParamsContext } from "@/components/recommenderGraph/paramsContext";
import { DEFAULT_PROMOTED_ALBUM } from "@/context/promotedAlbumDefaults";
import {
  makeGraph,
  makeNode,
} from "@/components/recommenderGraph/__tests__/fixtures";
import type { RecommenderGraph } from "@shared/recommenderGraph";

function renderList(graph: RecommenderGraph) {
  const update = vi.fn();
  const openFlow = vi.fn();
  render(
    <RecommenderParamsContext.Provider
      value={{
        config: DEFAULT_PROMOTED_ALBUM,
        update,
        openFlow,
        arrivedAt: null,
      }}
    >
      <RecommenderListView graph={graph} flow="profile" />
    </RecommenderParamsContext.Provider>
  );
  return update;
}

describe("RecommenderListView", () => {
  it("groups knobs under the node they belong to", () => {
    renderList(makeGraph([makeNode()]));

    expect(screen.getByText("Rating boost")).toBeInTheDocument();
    expect(screen.getByLabelText("Rating weight")).toHaveValue(
      DEFAULT_PROMOTED_ALBUM.ratingWeight
    );
  });

  it("shows the full explanation without asking, unlike the canvas", () => {
    renderList(makeGraph([makeNode()]));

    expect(screen.getByText(/star ratings boost/i)).toBeInTheDocument();
  });

  it("says what changing a knob on this node costs", () => {
    renderList(makeGraph([makeNode()]));

    expect(
      screen.getByText(/Rebuilds every stored taste profile/i)
    ).toBeInTheDocument();
  });

  it("skips nodes that own no knobs", () => {
    renderList(
      makeGraph([
        makeNode(),
        makeNode({ id: "signalLog", title: "Signal log", params: [] }),
      ])
    );

    expect(screen.queryByText("Signal log")).not.toBeInTheDocument();
  });

  it("edits through the same context the canvas uses", () => {
    const update = renderList(makeGraph([makeNode()]));

    fireEvent.change(screen.getByLabelText("Rating weight"), {
      target: { value: "2" },
    });

    expect(update).toHaveBeenCalledWith("ratingWeight", 2);
  });

  it("carries the same anatomy the cards show", () => {
    renderList(
      makeGraph([
        makeNode({
          does: ["Groups by artist"],
          gives: "A ranked artist set",
        }),
      ])
    );

    expect(screen.getByText("Groups by artist")).toBeInTheDocument();
    expect(screen.getByText("A ranked artist set")).toBeInTheDocument();
  });
});
