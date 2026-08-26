import { durationUnit, humanizeDuration } from "../duration";

describe("humanizeDuration", () => {
  it("leaves a minute count that already reads clearly alone", () => {
    expect(humanizeDuration(45, "minutes")).toBeNull();
    expect(humanizeDuration(119, "minutes")).toBeNull();
  });

  it("says whole hours as hours", () => {
    expect(humanizeDuration(120, "minutes")).toBe("2 h");
    expect(humanizeDuration(150, "minutes")).toBe("2 h 30 min");
  });

  it("says the five-figure knobs in days", () => {
    expect(humanizeDuration(1440, "minutes")).toBe("1 day");
    expect(humanizeDuration(10080, "minutes")).toBe("7 days");
    expect(humanizeDuration(43200, "minutes")).toBe("30 days");
  });

  it("keeps the remainder rather than rounding it away", () => {
    expect(humanizeDuration(1815, "minutes")).toBe("1 day 6 h 15 min");
  });

  it("leaves a day count that already reads clearly alone", () => {
    expect(humanizeDuration(7, "days")).toBeNull();
    expect(humanizeDuration(59, "days")).toBeNull();
  });

  it("claims a year only when the days divide into whole ones", () => {
    expect(humanizeDuration(365, "days")).toBe("1 year");
    expect(humanizeDuration(730, "days")).toBe("2 years");
    expect(humanizeDuration(360, "days")).toBe("≈ 12 months");
  });

  it("marks a month count as the approximation it is", () => {
    expect(humanizeDuration(91, "days")).toBe("≈ 3 months");
  });

  it("says nothing about a span of nothing", () => {
    expect(humanizeDuration(0, "minutes")).toBeNull();
    expect(humanizeDuration(Number.NaN, "days")).toBeNull();
  });
});

describe("durationUnit", () => {
  it("agrees with the number in front of it", () => {
    expect(durationUnit(1, "minutes")).toBe("minute");
    expect(durationUnit(60, "minutes")).toBe("minutes");
    expect(durationUnit(1, "days")).toBe("day");
    expect(durationUnit(0, "days")).toBe("days");
  });
});
