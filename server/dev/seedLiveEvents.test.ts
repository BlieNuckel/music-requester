import { describe, it, expect } from "vitest";
import { SEED_LIVE_EVENTS, SEED_FOLLOWED_ARTISTS } from "./seedLiveEvents";

const KEYS = SEED_LIVE_EVENTS.map((event) => event.key);
const FOLLOWED_IDS = new Set(
  SEED_FOLLOWED_ARTISTS.map((artist) => artist.jambaseId)
);

function find(predicate: (e: (typeof SEED_LIVE_EVENTS)[number]) => boolean) {
  return SEED_LIVE_EVENTS.filter(predicate);
}

describe("seed data shape", () => {
  it("uses unique event keys", () => {
    expect(new Set(KEYS).size).toBe(KEYS.length);
  });

  it("uses real MusicBrainz ids so artist pages resolve", () => {
    for (const artist of SEED_FOLLOWED_ARTISTS) {
      expect(artist.mbid).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("gives every performer genres, which the shelf ranks on", () => {
    for (const event of SEED_LIVE_EVENTS) {
      for (const performer of event.performers) {
        expect(performer.genres.length).toBeGreaterThan(0);
      }
    }
  });

  it("gives every event a headliner to lead the copy with", () => {
    for (const event of SEED_LIVE_EVENTS) {
      expect(event.performers.some((p) => p.isHeadliner)).toBe(true);
    }
  });
});

describe("state coverage", () => {
  it("covers a just-announced local show for the banner", () => {
    expect(
      find(
        (e) => e.seenDaysAgo <= 14 && e.dayOffset > 0 && e.venueCountry === "SE"
      )
    ).not.toHaveLength(0);
  });

  it("covers a show that is only in the imminent window", () => {
    expect(
      find((e) => e.seenDaysAgo > 14 && e.dayOffset <= 21)
    ).not.toHaveLength(0);
  });

  it("covers a regional show", () => {
    expect(find((e) => e.venueCountry !== "SE")).not.toHaveLength(0);
  });

  it("covers the quiet gap between both windows", () => {
    expect(
      find((e) => e.seenDaysAgo > 14 && e.dayOffset > 45)
    ).not.toHaveLength(0);
  });

  it("covers each non-scheduled status", () => {
    for (const status of ["cancelled", "rescheduled"]) {
      expect(find((e) => e.status === status)).not.toHaveLength(0);
    }
  });

  it("keeps status changes old enough not to hijack the banner by default", () => {
    for (const event of find((e) => e.status !== "scheduled")) {
      expect(event.statusChangedDaysAgo).toBeGreaterThan(14);
    }
  });

  it("pairs a rescheduled show with the date it moved from", () => {
    for (const event of find((e) => e.status === "rescheduled")) {
      expect(event.previousStartDayOffset).toBeDefined();
    }
  });

  it("covers every /library/live tab", () => {
    expect(find((e) => e.adminResponse === "going")).not.toHaveLength(0);
    expect(find((e) => e.adminResponse === "dismissed")).not.toHaveLength(0);
    expect(find((e) => e.dayOffset < 0)).not.toHaveLength(0);
  });

  it("covers both sides of the shelf's Following badge", () => {
    const performers = SEED_LIVE_EVENTS.flatMap((e) => e.performers);
    expect(performers.some((p) => FOLLOWED_IDS.has(p.jambaseId))).toBe(true);
    expect(performers.some((p) => !FOLLOWED_IDS.has(p.jambaseId))).toBe(true);
  });

  it("covers a show with no ticket link", () => {
    expect(find((e) => e.ticketUrl === null)).not.toHaveLength(0);
  });

  it("covers a multi-artist bill", () => {
    expect(find((e) => e.performers.length > 1)).not.toHaveLength(0);
  });
});
