import { describe, it, expect } from "vitest";
import {
  adjustArtistWeights,
  deriveArtistListening,
  deriveArtistRatings,
  toPlayEquivalents,
  type ArtistListening,
} from "./artistWeighting";
import { NOMINAL_TRACK_MS } from "./signalIngestion";
import type { ListeningWindow, WindowedPlay } from "./listeningWindow";
import type { PlexRatingPayload } from "./signalIngestion";

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

type RatedSpec = {
  ratingKey: string;
  kind: "track" | "album";
  rating: number;
  artist?: string;
};

const rated = (...items: RatedSpec[]): Map<string, PlexRatingPayload> =>
  new Map(
    items.map((item) => [
      item.ratingKey,
      { title: item.ratingKey, artist: "A", ...item },
    ])
  );

const listening = (overrides: Partial<ArtistListening>): ArtistListening => ({
  name: "A",
  weight: 10,
  plays: 10,
  listenedMs: 10 * NOMINAL_TRACK_MS,
  distinctTracksPlayed: 5,
  topTrackShare: 0.2,
  ...overrides,
});

const adjustOptions = (overrides = {}) => ({ ratingWeight: 0, ...overrides });

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
});

describe("deriveArtistRatings", () => {
  it("weights a rating by the listening it covers", () => {
    const ratings = deriveArtistRatings(
      rated(
        { ratingKey: "1", kind: "track", rating: 10 },
        { ratingKey: "2", kind: "track", rating: 2 }
      ),
      window(
        row({ ratingKey: "1", plays: 9 }),
        row({ ratingKey: "2", plays: 0 })
      )
    );

    expect(ratings.get("A")?.rating).toBeCloseTo((10 * 10 + 2 * 1) / 11, 5);
  });

  it("joins an album rating onto the plays its tracks hold", () => {
    const ratings = deriveArtistRatings(
      rated({ ratingKey: "alb", kind: "album", rating: 10 }),
      window(
        row({ ratingKey: "1", plays: 2 }),
        row({ ratingKey: "2", plays: 3 })
      )
    );

    expect(ratings.get("A")?.rating).toBe(10);
  });

  it("still counts a rated item the window holds no listening for", () => {
    const ratings = deriveArtistRatings(
      rated({ ratingKey: "unplayed", kind: "track", rating: 6 }),
      window()
    );

    expect(ratings.get("A")).toEqual({ rating: 6 });
  });

  it("excludes a cleared star rather than counting it as zero", () => {
    const ratings = deriveArtistRatings(
      rated(
        { ratingKey: "1", kind: "track", rating: 8 },
        { ratingKey: "2", kind: "track", rating: 0 }
      ),
      window(row({ ratingKey: "1", plays: 1 }))
    );

    expect(ratings.get("A")).toEqual({ rating: 8 });
  });
});

describe("adjustArtistWeights", () => {
  it("boosts by the rating", () => {
    const [artist] = adjustArtistWeights(
      [listening({})],
      new Map([["A", { rating: 10 }]]),
      adjustOptions({ ratingWeight: 0.5 })
    );

    expect(artist.ratingMultiplier).toBe(1.5);
    expect(artist.weight).toBe(15);
  });

  it("leaves an unrated artist unboosted and unmarked", () => {
    const [artist] = adjustArtistWeights(
      [listening({})],
      new Map(),
      adjustOptions({ ratingWeight: 2 })
    );

    expect(artist.weight).toBe(10);
    expect(artist).not.toHaveProperty("ratingMultiplier");
  });

  /**
   * The one-hit discount used to sit here, scaling this weight down by how concentrated an
   * artist's listening was. Nothing about how the listening is spread reaches the weight now.
   */
  it("ignores how an artist's listening is spread", () => {
    const [onOneTrack] = adjustArtistWeights(
      [listening({ distinctTracksPlayed: 1, topTrackShare: 1 })],
      new Map(),
      adjustOptions()
    );
    const [spreadWide] = adjustArtistWeights(
      [listening({ distinctTracksPlayed: 20, topTrackShare: 0.05 })],
      new Map(),
      adjustOptions()
    );

    expect(onOneTrack.weight).toBe(spreadWide.weight);
  });
});
