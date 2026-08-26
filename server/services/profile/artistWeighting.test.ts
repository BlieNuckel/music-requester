import { describe, it, expect } from "vitest";
import {
  adjustArtistWeights,
  concentrationOf,
  deriveArtistListening,
  deriveArtistRatings,
  toPlayEquivalents,
  type ArtistListening,
} from "./artistWeighting";
import { NOMINAL_TRACK_MS } from "./signalIngestion";
import type { ListeningWindow, WindowedPlay } from "./listeningWindow";
import type { UserSignalEvent } from "../../db/entity/UserSignalEvent";

type RowSpec = Partial<WindowedPlay> & { ratingKey: string };

const row = (spec: RowSpec): WindowedPlay => ({
  artistKey: `ak-${spec.artistName ?? "A"}`,
  artistName: "A",
  albumKey: "alb",
  albumTitle: "Album",
  plays: 1,
  listenedMs: NOMINAL_TRACK_MS,
  ...spec,
});

function window(...rows: WindowedPlay[]): ListeningWindow {
  return {
    startMs: 0,
    source: "deltas",
    plays: new Map(rows.map((entry) => [entry.ratingKey, entry])),
  };
}

function ratingEvent(item: {
  ratingKey: string;
  kind: "track" | "album";
  rating: number;
  artist?: string;
}): UserSignalEvent {
  return {
    id: 0,
    user_id: 1,
    kind: "plex_rating",
    payload: JSON.stringify({ title: item.ratingKey, ...item }),
    recorded_at: "2026-06-01T00:00:00.000Z",
  } as UserSignalEvent;
}

const listening = (overrides: Partial<ArtistListening>): ArtistListening => ({
  name: "A",
  weight: 10,
  plays: 10,
  listenedMs: 10 * NOMINAL_TRACK_MS,
  distinctTracksPlayed: 5,
  topTrackShare: 0.2,
  ...overrides,
});

const adjustOptions = (overrides = {}) => ({
  distributionWeight: 1,
  minPlays: 5,
  ratingWeight: 0,
  ...overrides,
});

describe("toPlayEquivalents", () => {
  it("counts a nominal-length play as one, so thresholds keep their meaning", () => {
    expect(toPlayEquivalents(4, 4 * NOMINAL_TRACK_MS, 1)).toBe(4);
  });

  it("lets one long set outweigh one short single when ranking on time", () => {
    expect(toPlayEquivalents(1, 3_600_000, 1)).toBeGreaterThan(
      toPlayEquivalents(1, 180_000, 1)
    );
  });

  it("ignores listening time entirely when ranking on plays", () => {
    expect(toPlayEquivalents(3, 3_600_000, 0)).toBe(3);
  });
});

describe("deriveArtistListening", () => {
  it("carries the weight and the spread out of one pass", () => {
    const [artist] = deriveArtistListening(
      window(
        row({ ratingKey: "1", plays: 8, listenedMs: 800 }),
        row({ ratingKey: "2", plays: 2, listenedMs: 200 })
      ),
      0
    );

    expect(artist).toMatchObject({
      name: "A",
      weight: 10,
      plays: 10,
      distinctTracksPlayed: 2,
      topTrackShare: 0.8,
    });
  });

  it("keeps an artist played but credited no time when ranking on time", () => {
    const artists = deriveArtistListening(
      window(row({ ratingKey: "1", plays: 3, listenedMs: 0 })),
      1
    );

    expect(artists).toHaveLength(1);
    expect(artists[0].weight).toBe(0);
  });

  it("drops an artist with nothing in the window", () => {
    expect(
      deriveArtistListening(
        window(row({ ratingKey: "1", plays: 0, listenedMs: 0 })),
        0
      )
    ).toEqual([]);
  });

  it("drops placeholder artists", () => {
    expect(
      deriveArtistListening(
        window(
          row({ ratingKey: "1", artistName: "Various Artists", plays: 4 })
        ),
        0
      )
    ).toEqual([]);
  });

  it("reports no concentration for an artist with no listening time", () => {
    const [artist] = deriveArtistListening(
      window(row({ ratingKey: "1", plays: 3, listenedMs: 0 })),
      0
    );

    expect(artist.topTrackShare).toBe(0);
  });
});

describe("deriveArtistRatings", () => {
  it("weights a rating by the listening it covers", () => {
    const ratings = deriveArtistRatings(
      [
        ratingEvent({ ratingKey: "1", kind: "track", rating: 10, artist: "A" }),
        ratingEvent({ ratingKey: "2", kind: "track", rating: 2, artist: "A" }),
      ],
      window(
        row({ ratingKey: "1", plays: 9 }),
        row({ ratingKey: "2", plays: 0 })
      )
    );

    expect(ratings.get("A")?.rating).toBeCloseTo((10 * 10 + 2 * 1) / 11, 5);
  });

  it("reads breadth off how many things were rated, not off which", () => {
    const one = deriveArtistRatings(
      [ratingEvent({ ratingKey: "1", kind: "track", rating: 8, artist: "A" })],
      window(row({ ratingKey: "1", plays: 9 }))
    );
    const three = deriveArtistRatings(
      [
        ratingEvent({ ratingKey: "1", kind: "track", rating: 8, artist: "A" }),
        ratingEvent({ ratingKey: "2", kind: "track", rating: 8, artist: "A" }),
        ratingEvent({ ratingKey: "3", kind: "track", rating: 8, artist: "A" }),
      ],
      window(row({ ratingKey: "1", plays: 9 }))
    );

    expect(one.get("A")?.breadth).toBe(0);
    expect(three.get("A")?.breadth).toBeCloseTo(2 / 3, 5);
  });

  it("joins an album rating onto the plays its tracks hold", () => {
    const ratings = deriveArtistRatings(
      [
        ratingEvent({
          ratingKey: "alb",
          kind: "album",
          rating: 10,
          artist: "A",
        }),
      ],
      window(
        row({ ratingKey: "1", plays: 2 }),
        row({ ratingKey: "2", plays: 3 })
      )
    );

    expect(ratings.get("A")?.rating).toBe(10);
  });

  it("still counts a rated item the window holds no listening for", () => {
    const ratings = deriveArtistRatings(
      [
        ratingEvent({
          ratingKey: "unplayed",
          kind: "track",
          rating: 6,
          artist: "A",
        }),
      ],
      window()
    );

    expect(ratings.get("A")).toEqual({ rating: 6, breadth: 0 });
  });

  it("excludes a cleared star rather than counting it as zero", () => {
    const ratings = deriveArtistRatings(
      [
        ratingEvent({ ratingKey: "1", kind: "track", rating: 8, artist: "A" }),
        ratingEvent({ ratingKey: "2", kind: "track", rating: 0, artist: "A" }),
      ],
      window(row({ ratingKey: "1", plays: 1 }))
    );

    expect(ratings.get("A")).toEqual({ rating: 8, breadth: 0 });
  });
});

describe("concentrationOf", () => {
  it("scores one played track as no evidence at all", () => {
    expect(concentrationOf(1, 1)).toBe(0);
  });

  it("scores evenly spread listening as no concentration", () => {
    expect(concentrationOf(0.1, 10)).toBe(0);
    expect(concentrationOf(0.5, 2)).toBe(0);
  });

  it("scores everything on one of many tracks as full concentration", () => {
    expect(concentrationOf(1, 10)).toBe(1);
  });

  it("scales between the two", () => {
    expect(concentrationOf(0.9, 10)).toBeCloseTo(8 / 9, 5);
  });

  it("clamps below-average concentration to zero rather than paying a bonus", () => {
    expect(concentrationOf(0.02, 10)).toBe(0);
  });
});

describe("adjustArtistWeights", () => {
  it("discounts an artist whose listening sits on one of many tracks", () => {
    const [artist] = adjustArtistWeights(
      [listening({ distinctTracksPlayed: 10, topTrackShare: 1 })],
      new Map(),
      adjustOptions()
    );

    expect(artist.concentration).toBe(1);
    expect(artist.weight).toBe(0);
  });

  it("leaves an artist who played one track alone, with no catalogue lookup", () => {
    const [artist] = adjustArtistWeights(
      [listening({ distinctTracksPlayed: 1, topTrackShare: 1 })],
      new Map(),
      adjustOptions()
    );

    expect(artist.distributionFactor).toBe(1);
    expect(artist.weight).toBe(10);
  });

  it("leaves an artist below the play floor alone", () => {
    const [artist] = adjustArtistWeights(
      [listening({ plays: 4, distinctTracksPlayed: 10, topTrackShare: 1 })],
      new Map(),
      adjustOptions()
    );

    expect(artist.distributionFactor).toBe(1);
  });

  it("lets ratings spread across the catalogue refute the discount", () => {
    const [artist] = adjustArtistWeights(
      [listening({ distinctTracksPlayed: 10, topTrackShare: 1 })],
      new Map([["A", { rating: 0, breadth: 0.75 }]]),
      adjustOptions()
    );

    expect(artist.distributionFactor).toBeCloseTo(0.75, 5);
  });

  it("is a no-op at a zero discount weight", () => {
    const [artist] = adjustArtistWeights(
      [listening({ distinctTracksPlayed: 10, topTrackShare: 1 })],
      new Map(),
      adjustOptions({ distributionWeight: 0 })
    );

    expect(artist.weight).toBe(10);
    expect(artist.concentration).toBe(0);
  });

  it("boosts by the rating on the same pass", () => {
    const [artist] = adjustArtistWeights(
      [listening({ distinctTracksPlayed: 4, topTrackShare: 0.25 })],
      new Map([["A", { rating: 10, breadth: 0 }]]),
      adjustOptions({ ratingWeight: 0.5 })
    );

    expect(artist.ratingMultiplier).toBe(1.5);
    expect(artist.weight).toBe(15);
  });

  it("leaves an unrated artist unboosted and unmarked", () => {
    const [artist] = adjustArtistWeights(
      [listening({ distinctTracksPlayed: 4, topTrackShare: 0.25 })],
      new Map(),
      adjustOptions({ ratingWeight: 2 })
    );

    expect(artist.weight).toBe(10);
    expect(artist).not.toHaveProperty("ratingMultiplier");
  });
});
