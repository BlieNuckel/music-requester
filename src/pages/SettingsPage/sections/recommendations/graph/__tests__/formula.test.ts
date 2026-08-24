import { parseFormula, reachableParamKeys } from "../formula";
import { listeningWeightParam, ratingWeightParam } from "./fixtures";

describe("parseFormula", () => {
  it("splits a formula into text around its placeholders", () => {
    const segments = parseFormula(
      "weight x (1 + {ratingWeight} x stars/10)",
      new Set(["ratingWeight"])
    );

    expect(segments).toEqual([
      { kind: "text", text: "weight x (1 + " },
      { kind: "param", key: "ratingWeight" },
      { kind: "text", text: " x stars/10)" },
    ]);
  });

  it("handles a formula that starts and ends with a placeholder", () => {
    const segments = parseFormula("{a} to {b}", new Set(["a", "b"]));

    expect(segments).toEqual([
      { kind: "param", key: "a" },
      { kind: "text", text: " to " },
      { kind: "param", key: "b" },
    ]);
  });

  it("leaves an unknown placeholder as literal text", () => {
    const segments = parseFormula("keep {mystery} tags", new Set(["other"]));

    expect(segments).toEqual([
      { kind: "text", text: "keep " },
      { kind: "text", text: "{mystery}" },
      { kind: "text", text: " tags" },
    ]);
  });

  it("returns plain text unchanged", () => {
    expect(parseFormula("no placeholders", new Set())).toEqual([
      { kind: "text", text: "no placeholders" },
    ]);
  });
});

describe("reachableParamKeys", () => {
  it("covers both owned and referenced params", () => {
    expect(
      reachableParamKeys([ratingWeightParam], [listeningWeightParam])
    ).toEqual(new Set(["ratingWeight", "listeningWeight"]));
  });
});
