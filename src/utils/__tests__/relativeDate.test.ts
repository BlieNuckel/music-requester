import { formatRelativeReleaseDate } from "../relativeDate";

const NOW = Date.parse("2026-07-09T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

describe("formatRelativeReleaseDate", () => {
  it("returns today for the current day", () => {
    expect(formatRelativeReleaseDate(daysAgo(0), NOW)).toBe("today");
  });

  it("returns yesterday for one day ago", () => {
    expect(formatRelativeReleaseDate(daysAgo(1), NOW)).toBe("yesterday");
  });

  it("returns days for under two weeks", () => {
    expect(formatRelativeReleaseDate(daysAgo(5), NOW)).toBe("5 days ago");
    expect(formatRelativeReleaseDate(daysAgo(13), NOW)).toBe("13 days ago");
  });

  it("returns weeks for under two months", () => {
    expect(formatRelativeReleaseDate(daysAgo(21), NOW)).toBe("3 weeks ago");
    expect(formatRelativeReleaseDate(daysAgo(59), NOW)).toBe("8 weeks ago");
  });

  it("returns months beyond that", () => {
    expect(formatRelativeReleaseDate(daysAgo(90), NOW)).toBe("3 months ago");
  });

  it("returns null for missing, malformed, or future dates", () => {
    expect(formatRelativeReleaseDate(null, NOW)).toBeNull();
    expect(formatRelativeReleaseDate("not-a-date", NOW)).toBeNull();
    expect(formatRelativeReleaseDate(daysAgo(-5), NOW)).toBeNull();
  });
});
