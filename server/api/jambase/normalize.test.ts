import { describe, it, expect } from "vitest";
import { normalizeEvents, normalizeStatus, toCalendarDay } from "./normalize";
import type { JambaseEvent } from "./types";

const RAW_EVENT: JambaseEvent = {
  "@type": "Concert",
  name: "Yves Tumor at Amiralen",
  identifier: "jambase:100",
  url: "https://www.jambase.com/show/100",
  image: "https://example.test/art.png",
  eventStatus: "https://schema.org/EventScheduled",
  startDate: "2026-08-30T19:00:00Z",
  location: {
    "@type": "MusicVenue",
    name: "Amiralen",
    identifier: "jambase:v1",
    address: { addressLocality: "Malmö", addressCountry: "SE" },
    geo: { latitude: 55.605, longitude: 13.0038 },
  },
  performer: [
    {
      name: "Yves Tumor",
      identifier: "jambase:1",
      "x-isHeadliner": true,
      "x-performanceRank": 1,
    },
  ],
  offers: [{ url: "https://tickets.test/100" }],
};

describe("normalizeStatus", () => {
  it("takes the leaf of a schema.org URL", () => {
    expect(normalizeStatus("https://schema.org/EventCancelled")).toBe(
      "cancelled"
    );
    expect(normalizeStatus("https://schema.org/EventPostponed")).toBe(
      "postponed"
    );
    expect(normalizeStatus("https://schema.org/EventRescheduled")).toBe(
      "rescheduled"
    );
  });

  it("accepts bare values and both cancelled spellings", () => {
    expect(normalizeStatus("cancelled")).toBe("cancelled");
    expect(normalizeStatus("EventCanceled")).toBe("cancelled");
  });

  it("defaults to scheduled for missing or unknown values", () => {
    expect(normalizeStatus(null)).toBe("scheduled");
    expect(normalizeStatus("something-else")).toBe("scheduled");
  });
});

describe("toCalendarDay", () => {
  it("truncates an RFC3339 timestamp to a calendar day", () => {
    expect(toCalendarDay("2026-08-30T19:00:00Z")).toBe("2026-08-30");
  });

  it("returns null for junk", () => {
    expect(toCalendarDay(null)).toBeNull();
    expect(toCalendarDay("soon")).toBeNull();
  });
});

describe("normalizeEvents", () => {
  it("maps a full event", () => {
    const { events, tombstones, skipped } = normalizeEvents([RAW_EVENT]);

    expect(tombstones).toEqual([]);
    expect(skipped).toBe(0);
    expect(events[0]).toEqual({
      event_key: "jambase:100",
      name: "Yves Tumor at Amiralen",
      event_date: "2026-08-30",
      previous_start_date: null,
      event_status: "scheduled",
      venue_name: "Amiralen",
      venue_city: "Malmö",
      venue_country: "SE",
      venue_lat: 55.605,
      venue_lon: 13.0038,
      ticket_url: "https://tickets.test/100",
      image_url: "https://example.test/art.png",
      performers: [
        {
          artist_jambase_id: "jambase:1",
          artist_name: "Yves Tumor",
          is_headliner: true,
          performance_rank: 1,
          genres: null,
        },
      ],
    });
  });

  it("rewrites UK to GB, since the API expects GB", () => {
    const { events } = normalizeEvents([
      {
        ...RAW_EVENT,
        location: {
          ...RAW_EVENT.location,
          address: { addressLocality: "London", addressCountry: "UK" },
        },
      },
    ]);
    expect(events[0].venue_country).toBe("GB");
  });

  it("reads a country given as an object", () => {
    const { events } = normalizeEvents([
      {
        ...RAW_EVENT,
        location: {
          ...RAW_EVENT.location,
          address: {
            addressLocality: "Berlin",
            addressCountry: { identifier: "de", name: "Germany" },
          },
        },
      },
    ]);
    expect(events[0].venue_country).toBe("DE");
  });

  it("accepts a single performer object as well as an array", () => {
    const { events } = normalizeEvents([
      { ...RAW_EVENT, performer: { name: "Solo", identifier: "jambase:9" } },
    ]);
    expect(events[0].performers).toHaveLength(1);
    expect(events[0].performers[0].is_headliner).toBe(false);
  });

  it("drops performers with no identifier, since that is the join key", () => {
    const { events } = normalizeEvents([
      {
        ...RAW_EVENT,
        performer: [
          { name: "Nameless" },
          { name: "Real", identifier: "jambase:2" },
        ],
      },
    ]);
    expect(events[0].performers.map((p) => p.artist_jambase_id)).toEqual([
      "jambase:2",
    ]);
  });

  it("deduplicates a performer listed twice", () => {
    const { events } = normalizeEvents([
      {
        ...RAW_EVENT,
        performer: [
          { name: "Yves Tumor", identifier: "jambase:1" },
          { name: "Yves Tumor", identifier: "jambase:1" },
        ],
      },
    ]);
    expect(events[0].performers).toHaveLength(1);
  });

  it("parses string coordinates and nulls unusable ones", () => {
    const { events } = normalizeEvents([
      {
        ...RAW_EVENT,
        location: {
          ...RAW_EVENT.location,
          geo: { latitude: "55.605", longitude: "" },
        },
      },
    ]);
    expect(events[0].venue_lat).toBe(55.605);
    expect(events[0].venue_lon).toBeNull();
  });

  it("falls back to the event url when there is no offer", () => {
    const { events } = normalizeEvents([{ ...RAW_EVENT, offers: null }]);
    expect(events[0].ticket_url).toBe("https://www.jambase.com/show/100");
  });

  it("keeps previousStartDate for a rescheduled show", () => {
    const { events } = normalizeEvents([
      {
        ...RAW_EVENT,
        eventStatus: "https://schema.org/EventRescheduled",
        previousStartDate: "2026-07-01T19:00:00Z",
      },
    ]);
    expect(events[0].event_status).toBe("rescheduled");
    expect(events[0].previous_start_date).toBe("2026-07-01");
  });

  it("skips rows with no identifier or no usable date", () => {
    const { events, skipped } = normalizeEvents([
      { ...RAW_EVENT, identifier: null },
      { ...RAW_EVENT, startDate: null },
    ]);
    expect(events).toEqual([]);
    expect(skipped).toBe(2);
  });

  it("separates tombstones from events on the same page", () => {
    const { events, tombstones } = normalizeEvents([
      RAW_EVENT,
      {
        "@type": "Concert",
        identifier: "jambase:200",
        deletionStatus: "deleted",
        deletedAt: "2026-08-20T00:00:00Z",
      },
      {
        "@type": "Concert",
        identifier: "jambase:300",
        deletionStatus: "merged",
        mergedInto: "jambase:400",
      },
    ]);

    expect(events.map((e) => e.event_key)).toEqual(["jambase:100"]);
    expect(tombstones).toEqual([
      {
        event_key: "jambase:200",
        deletion_status: "deleted",
        deleted_at: "2026-08-20T00:00:00Z",
        merged_into: null,
      },
      {
        event_key: "jambase:300",
        deletion_status: "merged",
        deleted_at: null,
        merged_into: "jambase:400",
      },
    ]);
  });

  it("ignores an unknown deletionStatus rather than dropping the row silently", () => {
    const { events, tombstones, skipped } = normalizeEvents([
      { ...RAW_EVENT, deletionStatus: "sideways" },
    ]);
    expect(tombstones).toEqual([]);
    expect(events).toHaveLength(1);
    expect(skipped).toBe(0);
  });

  it("handles a missing events array", () => {
    expect(normalizeEvents(undefined)).toEqual({
      events: [],
      tombstones: [],
      skipped: 0,
    });
  });
});

describe("performer genres", () => {
  it("carries genre slugs through for shelf affinity", () => {
    const { events } = normalizeEvents([
      {
        ...RAW_EVENT,
        performer: [
          {
            name: "Yves Tumor",
            identifier: "jambase:1",
            genre: ["art-pop", "experimental"],
          },
        ],
      },
    ]);

    expect(events[0].performers[0].genres).toEqual(["art-pop", "experimental"]);
  });

  it("nulls genres when the performer has none", () => {
    const { events } = normalizeEvents([
      { ...RAW_EVENT, performer: [{ name: "A", identifier: "jambase:1" }] },
    ]);
    expect(events[0].performers[0].genres).toBeNull();
  });
});
