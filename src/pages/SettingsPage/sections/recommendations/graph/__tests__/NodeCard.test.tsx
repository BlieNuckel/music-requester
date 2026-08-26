import { render, screen, fireEvent } from "@testing-library/react";
import { ExternalCard, NodeCard } from "../NodeCard";
import { RecommenderParamsContext } from "../paramsContext";
import { DEFAULT_PROMOTED_ALBUM } from "@/context/promotedAlbumDefaults";
import { listeningWeightParam, makeNode, ratingWeightParam } from "./fixtures";
import type { GraphNode } from "@shared/recommenderGraph";
import type { PromotedAlbumSettings } from "@/context/settingsContextDef";

function renderCard(
  node: GraphNode,
  config: PromotedAlbumSettings = DEFAULT_PROMOTED_ALBUM
) {
  const update = vi.fn();
  const openFlow = vi.fn();
  render(
    <RecommenderParamsContext.Provider
      value={{ config, update, openFlow, arrivedAt: null }}
    >
      <NodeCard node={node} />
    </RecommenderParamsContext.Provider>
  );
  return update;
}

describe("ExternalCard", () => {
  it("names the flow that owns the node rather than repeating its knobs", () => {
    const openFlow = vi.fn();
    render(
      <RecommenderParamsContext.Provider
        value={{
          config: DEFAULT_PROMOTED_ALBUM,
          update: vi.fn(),
          openFlow,
          arrivedAt: null,
        }}
      >
        <ExternalCard node={makeNode({ title: "Stored profile" })} />
      </RecommenderParamsContext.Provider>
    );

    expect(screen.getByText("Stored profile")).toBeInTheDocument();
    expect(screen.getByText("Taste profile")).toBeInTheDocument();
    expect(screen.queryByLabelText("Rating weight")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open that flow/i }));
    expect(openFlow).toHaveBeenCalledWith("profile", "ratingMultiplier");
  });
});

describe("NodeCard", () => {
  it("renders the node's title, scope and summary", () => {
    renderCard(makeNode());

    expect(screen.getByText("Rating boost")).toBeInTheDocument();
    expect(screen.getByText("Taste profile")).toBeInTheDocument();
    expect(screen.getByText(/how highly you rate them/i)).toBeInTheDocument();
  });

  it("puts a live input inside the node's formula", () => {
    renderCard(makeNode());

    expect(screen.getByText("weight x (1 +")).toBeInTheDocument();
    expect(screen.getByLabelText("Rating weight")).toHaveValue(
      DEFAULT_PROMOTED_ALBUM.ratingWeight
    );
    expect(screen.getByText("x stars/10)")).toBeInTheDocument();
  });

  it("edits the knob a placeholder names, not the one whose sentence it sits in", () => {
    const update = renderCard(
      makeNode({
        params: [
          {
            ...ratingWeightParam,
            formula: "weight x (1 + {listeningWeight} x stars/10)",
          },
        ],
        usesParams: [listeningWeightParam],
      })
    );

    fireEvent.change(screen.getByLabelText("Listening time vs plays"), {
      target: { value: "0.6" },
    });

    expect(update).toHaveBeenCalledWith("listeningWeight", 0.6);
    expect(screen.queryByLabelText("Rating weight")).not.toBeInTheDocument();
  });

  it("reports an edit through the params context", () => {
    const update = renderCard(makeNode());

    fireEvent.change(screen.getByLabelText("Rating weight"), {
      target: { value: "1.2" },
    });

    expect(update).toHaveBeenCalledWith("ratingWeight", 1.2);
  });

  it("clamps an edit to the param's range", () => {
    const update = renderCard(makeNode());

    fireEvent.change(screen.getByLabelText("Rating weight"), {
      target: { value: "99" },
    });

    expect(update).toHaveBeenCalledWith("ratingWeight", 3);
  });

  it("keeps the long explanation folded away until asked", () => {
    renderCard(makeNode());

    expect(screen.queryByText(/star ratings boost/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /what do these do/i }));

    expect(screen.getByText(/star ratings boost/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Rebuilds every stored taste profile/i)
    ).toBeInTheDocument();
  });

  it("names the knobs it reads but does not own", () => {
    renderCard(makeNode({ usesParams: [listeningWeightParam] }));

    expect(
      screen.getByText(/also uses listening time vs plays/i)
    ).toBeInTheDocument();
  });

  it("flags a node that spends the shared lookup budget", () => {
    renderCard(makeNode({ spendsBudget: true }));

    expect(screen.getByText("budget")).toBeInTheDocument();
  });

  it("explains a repeat node rather than letting it read as one pass", () => {
    renderCard(
      makeNode({
        kind: "repeat",
        note: "Runs up to 5 + 3 attempts.",
        params: [],
      })
    );

    expect(screen.getByText("repeats")).toBeInTheDocument();
    expect(screen.getByText("Runs up to 5 + 3 attempts.")).toBeInTheDocument();
  });

  it("renders a checkbox knob by its label", () => {
    const update = renderCard(
      makeNode({
        params: [
          {
            key: "ratingsBackupEnabled",
            kind: "boolean",
            label: "Back up Plex ratings and play counts daily",
            description: "Once a day.",
          },
        ],
      })
    );

    const checkbox = screen.getByLabelText(/back up plex ratings/i);
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    expect(update).toHaveBeenCalledWith("ratingsBackupEnabled", false);
  });

  it("renders an enum knob as a choice per option", () => {
    const update = renderCard(
      makeNode({
        params: [
          {
            key: "libraryPreference",
            kind: "enum",
            label: "Library preference",
            options: [
              { value: "prefer_new", label: "Prefer new" },
              { value: "prefer_library", label: "Prefer library" },
            ],
            description: "Which side to try first.",
          },
        ],
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Prefer library" }));

    expect(update).toHaveBeenCalledWith("libraryPreference", "prefer_library");
  });

  it("marks a node whose body is written but not yet wired up", () => {
    renderCard(
      makeNode({ status: "ported", module: "server/services/profile/x.ts" })
    );

    expect(screen.getByText("not live")).toBeInTheDocument();
  });

  it("says nothing about wiring for a node the recommender runs", () => {
    renderCard(makeNode());

    expect(screen.queryByText("not live")).not.toBeInTheDocument();
  });

  it("lays the step out as what it takes, does and gives", () => {
    renderCard(
      makeNode({
        takes: ["The window's rows"],
        does: ["Groups by artist", "Counts distinct tracks played"],
        gives: "Each artist's weight",
      })
    );

    expect(screen.getByText("Takes")).toBeInTheDocument();
    expect(screen.getByText("Groups by artist")).toBeInTheDocument();
    expect(
      screen.getByText("Counts distinct tracks played")
    ).toBeInTheDocument();
    expect(screen.getByText("Each artist's weight")).toBeInTheDocument();
  });

  it("marks the node a reference was followed into", () => {
    render(
      <RecommenderParamsContext.Provider
        value={{
          config: DEFAULT_PROMOTED_ALBUM,
          update: vi.fn(),
          openFlow: vi.fn(),
          arrivedAt: "ratingMultiplier",
        }}
      >
        <NodeCard node={makeNode()} />
      </RecommenderParamsContext.Provider>
    );

    expect(
      screen.getByText("Rating boost").closest("[data-arrived]")
    ).not.toBeNull();
  });

  it("marks nothing when the flow was opened from the toolbar", () => {
    renderCard(makeNode());

    expect(document.querySelector("[data-arrived]")).toBeNull();
  });
});
