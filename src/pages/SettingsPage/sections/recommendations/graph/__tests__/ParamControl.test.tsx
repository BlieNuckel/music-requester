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
