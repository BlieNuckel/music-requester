import { render, screen, fireEvent } from "@testing-library/react";
import ParamControl from "../ParamControl";
import { RecommenderParamsContext } from "../paramsContext";
import { DEFAULT_PROMOTED_ALBUM } from "@/context/promotedAlbumDefaults";
import type { ParamDef } from "@shared/recommenderGraph";
import type { PromotedAlbumSettings } from "@/context/settingsContextDef";

const explorationRate: ParamDef = {
  key: "explorationRate",
  kind: "ratio",
  label: "Exploration mix",
  min: 0,
  max: 1,
  step: 0.05,
  description: "What share of the slots break out of your usual genres.",
};

const ratingWeight: ParamDef = {
  key: "ratingWeight",
  kind: "factor",
  label: "Rating weight",
  min: 0,
  max: 3,
  step: 0.1,
  description: "How much your stars boost an artist.",
};

const genericTags: ParamDef = {
  key: "genericTags",
  kind: "tags",
  label: "Generic tags",
  description: "Tags too broad to describe anyone's taste.",
};

const libraryPreference: ParamDef = {
  key: "libraryPreference",
  kind: "enum",
  label: "Library preference",
  options: [
    { value: "prefer_new", label: "Prefer new" },
    { value: "prefer_library", label: "Prefer library" },
  ],
  description: "Which side of the library line to try first.",
};

const backgroundRegen: ParamDef = {
  key: "backgroundRegenEnabled",
  kind: "boolean",
  label: "Keep taste profiles warm",
  description: "Rebuild stale profiles off the request path.",
};

const listeningWeight: ParamDef = {
  key: "listeningWeight",
  kind: "split",
  label: "Listening time vs plays",
  min: 0,
  max: 1,
  step: 0.05,
  ends: { low: "plays", high: "listening time" },
  description: "What counts as listening to an artist more.",
};

const profileTtl: ParamDef = {
  key: "profileTtlMinutes",
  kind: "minutes",
  label: "Profile lifetime",
  min: 0,
  max: 10080,
  step: 60,
  description: "How long a built profile is reused.",
};

const trendWindow: ParamDef = {
  key: "playTrendWindowDays",
  kind: "days",
  label: "Play trend window",
  min: 1,
  max: 365,
  step: 1,
  description: "How far back recent listening counts.",
};

function renderControl(
  param: ParamDef,
  overrides: Partial<PromotedAlbumSettings> = {},
  variant: "inline" | "block" = "block"
) {
  const update = vi.fn();
  render(
    <RecommenderParamsContext.Provider
      value={{
        config: { ...DEFAULT_PROMOTED_ALBUM, ...overrides },
        update,
        openFlow: vi.fn(),
        arrivedAt: null,
      }}
    >
      <ParamControl param={param} variant={variant} />
    </RecommenderParamsContext.Provider>
  );
  return update;
}

describe("ratio knobs", () => {
  it("reads as a percentage rather than a fraction to type", () => {
    renderControl(explorationRate, { explorationRate: 0.4 });

    expect(
      screen.getByRole("slider", { name: "Exploration mix" })
    ).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("still stores the fraction the pipeline multiplies by", () => {
    const update = renderControl(explorationRate, { explorationRate: 0.4 });

    fireEvent.change(screen.getByRole("slider"), { target: { value: "0.55" } });

    expect(update).toHaveBeenCalledWith("explorationRate", 0.55);
  });

  it("clamps a value past the knob's ceiling", () => {
    const update = renderControl(explorationRate);

    fireEvent.change(screen.getByRole("slider"), { target: { value: "2" } });

    expect(update).toHaveBeenCalledWith("explorationRate", 1);
  });
});

describe("split knobs", () => {
  it("names both ends and gives each its share", () => {
    renderControl(listeningWeight, { listeningWeight: 0.75 });

    expect(screen.getByText("plays")).toBeInTheDocument();
    expect(screen.getByText("listening time")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("uses one slider for the one value it stores", () => {
    renderControl(listeningWeight, { listeningWeight: 0.75 });

    expect(screen.getAllByRole("slider")).toHaveLength(1);
  });

  it("says the split rather than the fraction to a screen reader", () => {
    renderControl(listeningWeight, { listeningWeight: 0.75 });

    expect(screen.getByRole("slider")).toHaveAttribute(
      "aria-valuetext",
      "25% plays, 75% listening time"
    );
  });

  it("moves both ends from the one control", () => {
    const update = renderControl(listeningWeight, { listeningWeight: 0.75 });

    fireEvent.change(screen.getByRole("slider"), { target: { value: "0.2" } });

    expect(update).toHaveBeenCalledWith("listeningWeight", 0.2);
  });
});

describe("factor knobs", () => {
  it("takes a multiplier as a number, not as a share of something", () => {
    const update = renderControl(ratingWeight, { ratingWeight: 0.5 });

    const input = screen.getByLabelText("Rating weight");
    expect(input).toHaveAttribute("step", "0.1");
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "1.4" } });
    expect(update).toHaveBeenCalledWith("ratingWeight", 1.4);
  });
});

describe("duration knobs", () => {
  it("names its unit in the list, where no sentence does", () => {
    renderControl(profileTtl, { profileTtlMinutes: 1440 });

    expect(screen.getByText("minutes")).toBeInTheDocument();
    expect(screen.getByText("(1 day)")).toBeInTheDocument();
  });

  it("leaves the unit to the sentence it sits in", () => {
    renderControl(profileTtl, { profileTtlMinutes: 1440 }, "inline");

    expect(screen.queryByText("minutes")).not.toBeInTheDocument();
    expect(screen.getByText("(1 day)")).toBeInTheDocument();
  });

  it("says nothing extra about a number that already reads clearly", () => {
    renderControl(profileTtl, { profileTtlMinutes: 60 });

    expect(screen.getByText("minutes")).toBeInTheDocument();
    expect(screen.queryByText(/\(/)).not.toBeInTheDocument();
  });

  it("translates a long span of days too", () => {
    renderControl(trendWindow, { playTrendWindowDays: 365 });

    expect(screen.getByText("days")).toBeInTheDocument();
    expect(screen.getByText("(1 year)")).toBeInTheDocument();
  });

  it("keeps the number itself editable", () => {
    const update = renderControl(profileTtl, { profileTtlMinutes: 1440 });

    fireEvent.change(screen.getByLabelText("Profile lifetime"), {
      target: { value: "2880" },
    });

    expect(update).toHaveBeenCalledWith("profileTtlMinutes", 2880);
  });
});

/**
 * React Flow drags a node from any pointer-down that is not under a `.nodrag` element, and
 * preventDefaults it — which silently costs a slider every gesture it has.
 */
describe("knobs on the draggable canvas", () => {
  it.each([
    ["ratio", explorationRate, "slider"],
    ["split", listeningWeight, "slider"],
    ["factor", ratingWeight, "spinbutton"],
    ["minutes", profileTtl, "spinbutton"],
    ["days", trendWindow, "spinbutton"],
    ["enum", libraryPreference, "button"],
    ["boolean", backgroundRegen, "checkbox"],
    ["tags", genericTags, "textbox"],
  ])(
    "keeps the canvas from stealing a %s knob's gesture",
    (_kind, param, role) => {
      renderControl(param, {}, "inline");

      expect(screen.getAllByRole(role)[0].closest(".nodrag")).not.toBeNull();
    }
  );
});
