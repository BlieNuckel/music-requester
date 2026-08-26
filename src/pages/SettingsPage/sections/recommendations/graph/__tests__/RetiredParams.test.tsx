import { render, screen, fireEvent } from "@testing-library/react";
import RetiredParams from "../RetiredParams";
import { RecommenderParamsContext } from "../paramsContext";
import { DEFAULT_PROMOTED_ALBUM } from "@/context/promotedAlbumDefaults";
import type { RetiredParam } from "@shared/recommenderGraph";

const param: RetiredParam = {
  key: "minAvailableTracksForDistribution",
  kind: "int",
  label: "Small catalogue exemption",
  min: 0,
  max: 50,
  step: 1,
  description: "Artists with this many tracks or fewer keep their weight.",
  reason: "Concentration is measured against chance now.",
};

function renderWith(params: RetiredParam[], update = vi.fn()) {
  render(
    <RecommenderParamsContext.Provider
      value={{
        config: { ...DEFAULT_PROMOTED_ALBUM },
        update,
        openFlow: vi.fn(),
      }}
    >
      <RetiredParams params={params} />
    </RecommenderParamsContext.Provider>
  );
  return update;
}

describe("RetiredParams", () => {
  it("renders nothing when the pipeline has left no knob behind", () => {
    const { container } = render(<RetiredParams params={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("says why the knob is still here", () => {
    renderWith([param]);

    expect(screen.getByText("On their way out")).toBeInTheDocument();
    expect(
      screen.getByText("Concentration is measured against chance now.")
    ).toBeInTheDocument();
  });

  it("keeps the knob settable while the old path still reads it", () => {
    const update = renderWith([param]);
    const input = screen.getByRole("spinbutton");

    fireEvent.change(input, { target: { value: "7" } });

    expect(update).toHaveBeenCalledWith("minAvailableTracksForDistribution", 7);
  });
});
