import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetAllTrackPlayCounts = vi.fn();

vi.mock("../api/plex/trackPlayCounts", () => ({
  getAllTrackPlayCounts: (...args: unknown[]) =>
    mockGetAllTrackPlayCounts(...args),
}));

import {
  derivePlayWeights,
  toPlayEquivalents,
  deriveWindowedTrackPlays,
  deriveArtistDistributions,
  deriveTrackAvailability,
  applyDistributionFactor,
  reconstructArtistTotals,
  aggregateArtistRatings,
  applyRatingMultiplier,
  loadArtistWeights,
  deriveAlbumWeights,
  type ArtistRatingSignal,
  type ArtistWeight,
  type ArtistWeightOptions,
  type DistributionOptions,
  type PlayWeightOptions,
  type SignalBundle,
} from "./artistWeights";
import {
  NOMINAL_TRACK_MS,
  type ArtistPlayRollup,
} from "../services/profile/signalIngestion";
import { initializeDatabase, closeDatabase, getDataSource } from "../db";
import { appendSignalEvent, getSignalEvents } from "../db/userProfile";
import type { UserSignalEvent } from "../db/entity/UserSignalEvent";

type TrackSpec = {
  ratingKey: string;
  artistName: string;
  playCount: number;
  artistKey?: string;
  albumKey?: string;
  albumTitle?: string;
  durationMs?: number;
};

const DAY = 24 * 60 * 60 * 1000;

function playOptions(
  overrides: Partial<PlayWeightOptions> = {}
): PlayWeightOptions {
  return {
    now: NOW,
    windowMs: 30 * DAY,
    capMs: 0,
    listeningWeight: 1,
    ...overrides,
  };
}

function weightOptions(overrides: Partial<ArtistWeightOptions> = {}) {
  return {
    windowMs: 30 * DAY,
    ratingWeight: 0.5,
    distributionWeight: 0,
    minPlaysForDistribution: 5,
    minAvailableTracksForDistribution: 0,
    listeningWeight: 1,
    maxTrackMinutesForWeight: 0,
    now: NOW,
    ...overrides,
  };
}
const NOW = Date.parse("2026-06-28T00:00:00.000Z");

function legacyEvent(
  artists: { name: string; playCount: number }[],
  daysAgo: number
): UserSignalEvent {
  return {
    id: 0,
    user_id: 1,
    kind: "plex_plays",
    payload: JSON.stringify({ artists }),
    recorded_at: new Date(NOW - daysAgo * DAY).toISOString(),
  } as UserSignalEvent;
}

function trackEvent(tracks: TrackSpec[], daysAgo: number): UserSignalEvent {
  return {
    id: 0,
    user_id: 1,
    kind: "plex_track_plays",
    payload: JSON.stringify({
      tracks: tracks.map((track) => ({
        ratingKey: track.ratingKey,
        title: `t${track.ratingKey}`,
        artistKey: track.artistKey ?? `ak-${track.artistName}`,
        artistName: track.artistName,
        albumKey: track.albumKey ?? `alb-${track.artistName}`,
        albumTitle: track.albumTitle ?? "Album",
        playCount: track.playCount,
        durationMs: track.durationMs,
      })),
    }),
    recorded_at: new Date(NOW - daysAgo * DAY).toISOString(),
  } as UserSignalEvent;
}

function ratingEvent(
  artist: string,
  rating: number,
  overrides: { ratingKey?: string; kind?: "track" | "album" } = {}
): UserSignalEvent {
  return {
    id: 0,
    user_id: 1,
    kind: "plex_rating",
    payload: JSON.stringify({
      ratingKey: overrides.ratingKey ?? `${artist}-${rating}`,
      kind: overrides.kind ?? "track",
      title: "t",
      artist,
      rating,
    }),
    recorded_at: "2026-01-01T00:00:00.000Z",
  } as UserSignalEvent;
}

/** The two folds `loadArtistWeights` shares, from a raw track series. */
function foldTracks(events: UserSignalEvent[], windowStart: number | null) {
  const tracks = deriveWindowedTrackPlays(events, windowStart);
  return { tracks, distributions: deriveArtistDistributions(tracks) };
}

function artistDistributions(
  events: UserSignalEvent[],
  windowStart: number | null
) {
  return foldTracks(events, windowStart).distributions;
}

function ratingsFor(events: UserSignalEvent[], ratings: UserSignalEvent[]) {
  const { tracks, distributions } = foldTracks(events, null);
  return aggregateArtistRatings(ratings, tracks, distributions);
}

describe("reconstructArtistTotals", () => {
  it("accumulates track plays into per-artist totals", () => {
    const counts = reconstructArtistTotals(
      [
        trackEvent(
          [
            { ratingKey: "1", artistName: "A", playCount: 4 },
            { ratingKey: "2", artistName: "A", playCount: 6 },
            { ratingKey: "3", artistName: "B", playCount: 2 },
          ],
          0
        ),
      ],
      [],
      Infinity
    );
    expect(counts.get("A")).toEqual({
      plays: 10,
      listenedMs: 10 * NOMINAL_TRACK_MS,
    });
    expect(counts.get("B")?.plays).toBe(2);
  });

  it("groups by artistKey so a rename keeps one bucket", () => {
    const counts = reconstructArtistTotals(
      [
        trackEvent(
          [
            {
              ratingKey: "1",
              artistKey: "k1",
              artistName: "Old",
              playCount: 3,
            },
          ],
          2
        ),
        trackEvent(
          [
            {
              ratingKey: "2",
              artistKey: "k1",
              artistName: "New",
              playCount: 5,
            },
          ],
          0
        ),
      ],
      [],
      Infinity
    );
    expect([...counts.values()].map((t) => t.plays)).toEqual([8]);
  });

  it("keeps same-named artists separate when their keys differ", () => {
    const counts = reconstructArtistTotals(
      [
        trackEvent(
          [
            {
              ratingKey: "1",
              artistKey: "k1",
              artistName: "Nova",
              playCount: 3,
            },
            {
              ratingKey: "2",
              artistKey: "k2",
              artistName: "Nova",
              playCount: 5,
            },
          ],
          0
        ),
      ],
      [],
      Infinity
    );
    expect(counts.get("Nova")?.plays).toBe(5);
  });

  it("takes the higher of the two series per artist", () => {
    const counts = reconstructArtistTotals(
      [trackEvent([{ ratingKey: "1", artistName: "A", playCount: 4 }], 0)],
      [legacyEvent([{ name: "A", playCount: 30 }], 0)],
      Infinity
    );
    expect(counts.get("A")?.plays).toBe(30);
  });

  it("ignores events recorded after the cutoff", () => {
    const counts = reconstructArtistTotals(
      [
        trackEvent([{ ratingKey: "1", artistName: "A", playCount: 4 }], 40),
        trackEvent([{ ratingKey: "1", artistName: "A", playCount: 90 }], 0),
      ],
      [],
      NOW - 30 * DAY
    );
    expect(counts.get("A")?.plays).toBe(4);
  });

  it("carries listening time alongside the plays it came from", () => {
    const counts = reconstructArtistTotals(
      [
        trackEvent(
          [
            {
              ratingKey: "set",
              artistName: "A",
              playCount: 2,
              durationMs: 5_400_000,
            },
          ],
          0
        ),
      ],
      [],
      Infinity
    );
    expect(counts.get("A")).toEqual({ plays: 2, listenedMs: 10_800_000 });
  });

  it("caps what one play of a very long track is worth", () => {
    const counts = reconstructArtistTotals(
      [
        trackEvent(
          [
            {
              ratingKey: "set",
              artistName: "A",
              playCount: 2,
              durationMs: 5_400_000,
            },
          ],
          0
        ),
      ],
      [],
      Infinity,
      600_000
    );
    expect(counts.get("A")?.listenedMs).toBe(1_200_000);
  });

  it("enters the legacy artist series at the nominal length", () => {
    const counts = reconstructArtistTotals(
      [],
      [legacyEvent([{ name: "A", playCount: 30 }], 0)],
      Infinity
    );
    expect(counts.get("A")).toEqual({
      plays: 30,
      listenedMs: 30 * NOMINAL_TRACK_MS,
    });
  });
});

describe("derivePlayWeights", () => {
  it("returns windowed deltas when the track series spans the window", () => {
    const trackEvents = [
      trackEvent(
        [
          { ratingKey: "1", artistName: "A", playCount: 10 },
          { ratingKey: "2", artistName: "B", playCount: 5 },
        ],
        40
      ),
      trackEvent([{ ratingKey: "1", artistName: "A", playCount: 30 }], 0),
    ];
    const result = derivePlayWeights(trackEvents, [], new Map(), playOptions());
    expect(result.weights).toEqual([{ name: "A", viewCount: 20 }]);
    expect(result.windowStart).toBe(NOW - 30 * DAY);
  });

  it("falls back to latest all-time counts until the window is covered", () => {
    const trackEvents = [
      trackEvent([{ ratingKey: "1", artistName: "A", playCount: 10 }], 5),
      trackEvent([{ ratingKey: "1", artistName: "A", playCount: 12 }], 0),
    ];
    const result = derivePlayWeights(trackEvents, [], new Map(), playOptions());
    expect(result.weights).toEqual([{ name: "A", viewCount: 12 }]);
    expect(result.windowStart).toBeNull();
  });

  it("falls back to all-time when nothing was played in the window", () => {
    const trackEvents = [
      trackEvent([{ ratingKey: "1", artistName: "A", playCount: 10 }], 40),
      trackEvent([{ ratingKey: "1", artistName: "A", playCount: 10 }], 0),
    ];
    const result = derivePlayWeights(trackEvents, [], new Map(), playOptions());
    expect(result.weights).toEqual([{ name: "A", viewCount: 10 }]);
    expect(result.windowStart).toBeNull();
  });

  it("returns empty when neither series has captures", () => {
    expect(derivePlayWeights([], [], new Map(), playOptions())).toEqual({
      weights: [],
      windowStart: null,
    });
  });

  it("still derives windowed weights from a legacy-only series", () => {
    const legacyEvents = [
      legacyEvent(
        [
          { name: "A", playCount: 10 },
          { name: "B", playCount: 5 },
        ],
        40
      ),
      legacyEvent([{ name: "A", playCount: 30 }], 0),
    ];
    const result = derivePlayWeights(
      [],
      legacyEvents,
      new Map(),
      playOptions()
    );
    expect(result.weights).toEqual([{ name: "A", viewCount: 20 }]);
  });

  it("bridges a legacy baseline to a track-series latest across the cutover", () => {
    const legacyEvents = [legacyEvent([{ name: "A", playCount: 10 }], 40)];
    const trackEvents = [
      trackEvent(
        [
          { ratingKey: "1", artistName: "A", playCount: 12 },
          { ratingKey: "2", artistName: "A", playCount: 13 },
        ],
        0
      ),
    ];
    const result = derivePlayWeights(
      trackEvents,
      legacyEvents,
      new Map(),
      playOptions()
    );
    expect(result.weights).toEqual([{ name: "A", viewCount: 15 }]);
  });

  it("reports the all-time window when a legacy-only baseline covers it", () => {
    const legacyEvents = [
      legacyEvent([{ name: "A", playCount: 10 }], 40),
      legacyEvent([{ name: "A", playCount: 30 }], 0),
    ];
    const trackEvents = [
      trackEvent([{ ratingKey: "1", artistName: "A", playCount: 4 }], 0),
    ];
    const result = derivePlayWeights(
      trackEvents,
      legacyEvents,
      new Map(),
      playOptions()
    );
    expect(result.windowStart).toBe(NOW - 30 * DAY);
  });
});

describe("toPlayEquivalents", () => {
  it("counts a nominal-length play as one, so thresholds keep their meaning", () => {
    expect(
      toPlayEquivalents({ plays: 4, listenedMs: 4 * NOMINAL_TRACK_MS }, 1)
    ).toBe(4);
  });

  it("makes one hour-long set outweigh one short single", () => {
    const set = toPlayEquivalents({ plays: 1, listenedMs: 3_600_000 }, 1);
    const single = toPlayEquivalents({ plays: 1, listenedMs: 180_000 }, 1);
    expect(set).toBeGreaterThan(single);
  });

  it("ranks purely on plays at weight 0", () => {
    expect(toPlayEquivalents({ plays: 3, listenedMs: 5_400_000 }, 0)).toBe(3);
  });

  it("interpolates between recurrence and exposure", () => {
    const totals = { plays: 1, listenedMs: 60 * NOMINAL_TRACK_MS };
    expect(toPlayEquivalents(totals, 0.5)).toBe(30.5);
  });

  it("is unchanged by the knob when nothing carries a duration", () => {
    const totals = { plays: 7, listenedMs: 7 * NOMINAL_TRACK_MS };
    expect(toPlayEquivalents(totals, 0)).toBe(toPlayEquivalents(totals, 1));
  });
});

describe("derivePlayWeights with episodes", () => {
  function episode(
    ratingKey: string,
    artistName: string,
    daysAgo: number,
    listenedMs: number
  ) {
    return {
      ratingKey,
      title: `t${ratingKey}`,
      artistKey: `ak-${artistName}`,
      artistName,
      albumKey: `alb-${artistName}`,
      albumTitle: "Album",
      startedAt: NOW - daysAgo * DAY,
      durationMs: listenedMs,
      listenedMs,
      measured: false,
    };
  }

  function episodes(...items: ReturnType<typeof episode>[]) {
    return new Map(items.map((item, i) => [`e${i}`, item]));
  }

  it("weights from the episodes when history covers the window", () => {
    const result = derivePlayWeights(
      [trackEvent([{ ratingKey: "1", artistName: "A", playCount: 40 }], 60)],
      [],
      episodes(episode("1", "A", 40, 210_000), episode("1", "A", 10, 630_000)),
      playOptions()
    );

    expect(result.weights).toEqual([{ name: "A", viewCount: 3 }]);
    expect(result.windowStart).toBe(NOW - 30 * DAY);
  });

  it("counts a play once, not once per series", () => {
    const trackEvents = [
      trackEvent([{ ratingKey: "1", artistName: "A", playCount: 0 }], 60),
      trackEvent([{ ratingKey: "1", artistName: "A", playCount: 5 }], 0),
    ];
    const fromEpisodes = derivePlayWeights(
      trackEvents,
      [],
      episodes(episode("1", "A", 40, 210_000), episode("1", "A", 10, 210_000)),
      playOptions()
    );

    expect(fromEpisodes.weights[0].viewCount).toBe(1);
  });

  it("falls back to the count deltas when history starts inside the window", () => {
    const result = derivePlayWeights(
      [
        trackEvent([{ ratingKey: "1", artistName: "A", playCount: 10 }], 60),
        trackEvent([{ ratingKey: "1", artistName: "A", playCount: 14 }], 0),
      ],
      [],
      episodes(episode("1", "A", 10, 210_000)),
      playOptions()
    );

    expect(result.weights).toEqual([{ name: "A", viewCount: 4 }]);
  });

  it("caps what one very long episode is worth", () => {
    const result = derivePlayWeights(
      [trackEvent([{ ratingKey: "1", artistName: "A", playCount: 1 }], 60)],
      [],
      episodes(
        episode("1", "A", 40, 210_000),
        episode("1", "A", 10, 5_400_000)
      ),
      playOptions({ capMs: 600_000 })
    );

    expect(result.weights[0].viewCount).toBeCloseTo(600_000 / NOMINAL_TRACK_MS);
  });

  it("ignores episodes started outside the window", () => {
    const result = derivePlayWeights(
      [trackEvent([{ ratingKey: "1", artistName: "A", playCount: 1 }], 60)],
      [],
      episodes(episode("1", "A", 40, 210_000)),
      playOptions()
    );

    expect(result.windowStart).toBeNull();
  });
});

describe("deriveWindowedTrackPlays", () => {
  it("returns cumulative counts when the weights fell back to all-time", () => {
    const tracks = deriveWindowedTrackPlays(
      [
        trackEvent([{ ratingKey: "1", artistName: "A", playCount: 4 }], 40),
        trackEvent([{ ratingKey: "1", artistName: "A", playCount: 9 }], 0),
      ],
      null
    );
    expect(tracks.get("1")?.playCount).toBe(9);
  });

  it("subtracts the window baseline per track", () => {
    const tracks = deriveWindowedTrackPlays(
      [
        trackEvent(
          [
            { ratingKey: "1", artistName: "A", playCount: 100 },
            { ratingKey: "2", artistName: "A", playCount: 50 },
          ],
          40
        ),
        trackEvent([{ ratingKey: "1", artistName: "A", playCount: 110 }], 0),
      ],
      NOW - 30 * DAY
    );
    expect(tracks.get("1")?.playCount).toBe(10);
    expect(tracks.get("2")?.playCount).toBe(0);
  });
});

describe("deriveArtistDistributions", () => {
  it("reports plays, distinct tracks, and the top track per artist", () => {
    const dists = artistDistributions(
      [
        trackEvent(
          [
            { ratingKey: "1", artistName: "A", playCount: 30 },
            { ratingKey: "2", artistName: "A", playCount: 5 },
            { ratingKey: "3", artistName: "A", playCount: 5 },
          ],
          0
        ),
      ],
      null
    );
    expect(dists.get("A")).toMatchObject({
      playCount: 40,
      distinctTracksPlayed: 3,
      topTrackPlayCount: 30,
      topTrackKey: "1",
    });
  });

  it("measures the distribution inside the window once the series spans it", () => {
    const dists = artistDistributions(
      [
        trackEvent(
          [
            { ratingKey: "1", artistName: "A", playCount: 100 },
            { ratingKey: "2", artistName: "A", playCount: 100 },
          ],
          40
        ),
        trackEvent([{ ratingKey: "1", artistName: "A", playCount: 110 }], 0),
      ],
      NOW - 30 * DAY
    );
    expect(dists.get("A")).toMatchObject({
      playCount: 10,
      distinctTracksPlayed: 1,
      topTrackPlayCount: 10,
    });
  });

  it("keeps the busier artist when two share a name", () => {
    const dists = artistDistributions(
      [
        trackEvent(
          [
            {
              ratingKey: "1",
              artistKey: "k1",
              artistName: "Nova",
              playCount: 3,
            },
            {
              ratingKey: "2",
              artistKey: "k2",
              artistName: "Nova",
              playCount: 9,
            },
          ],
          0
        ),
      ],
      null
    );
    expect(dists.get("Nova")?.playCount).toBe(9);
  });

  it("keeps the artist holding more listening when two share a name", () => {
    const dists = artistDistributions(
      [
        trackEvent(
          [
            {
              ratingKey: "1",
              artistKey: "k1",
              artistName: "Nova",
              playCount: 3,
              durationMs: 5_400_000,
            },
            {
              ratingKey: "2",
              artistKey: "k2",
              artistName: "Nova",
              playCount: 9,
              durationMs: 180_000,
            },
          ],
          0
        ),
      ],
      null
    );
    expect(dists.get("Nova")?.playCount).toBe(3);
  });

  it("takes the most-listened track for the concentration share", () => {
    const dists = artistDistributions(
      [
        trackEvent(
          [
            {
              ratingKey: "set",
              artistName: "A",
              playCount: 1,
              durationMs: 5_400_000,
            },
            {
              ratingKey: "single",
              artistName: "A",
              playCount: 8,
              durationMs: 180_000,
            },
          ],
          0
        ),
      ],
      null
    );
    expect(dists.get("A")).toMatchObject({
      topTrackKey: "single",
      topTrackPlayCount: 8,
      topTrackListenedMs: 5_400_000,
    });
  });
});

describe("applyDistributionFactor", () => {
  const plays: ArtistWeight[] = [{ name: "A", viewCount: 200 }];
  const noRatings = new Map<string, ArtistRatingSignal>();
  const noAvailability = new Map<string, number>();

  function factor(
    distributions: Map<string, ArtistPlayRollup>,
    options: Partial<DistributionOptions> = {},
    ratings = noRatings,
    availability = noAvailability
  ) {
    return applyDistributionFactor(
      plays,
      { distributions, ratings, availability },
      {
        distributionWeight: 0.5,
        minPlays: 5,
        minAvailableTracks: 0,
        ...options,
      }
    );
  }

  function distributions(
    playCount: number,
    topTrackPlayCount: number,
    distinctTracksPlayed: number
  ) {
    return new Map([
      [
        "A",
        {
          artistKey: "ak-A",
          name: "A",
          playCount,
          listenedMs: playCount * NOMINAL_TRACK_MS,
          distinctTracksPlayed,
          topTrackPlayCount,
          topTrackListenedMs: topTrackPlayCount * NOMINAL_TRACK_MS,
          topTrackKey: "top",
        },
      ],
    ]);
  }

  function ratings(breadth: number) {
    return new Map<string, ArtistRatingSignal>([
      ["A", { rating: 10, breadth }],
    ]);
  }

  /** An artist whose plays and listening sit on different tracks. */
  function splitDistribution(
    playCount: number,
    topTrackPlayCount: number,
    listenedMs: number,
    topTrackListenedMs: number
  ) {
    return new Map([
      [
        "A",
        {
          artistKey: "ak-A",
          name: "A",
          playCount,
          listenedMs,
          distinctTracksPlayed: 2,
          topTrackPlayCount,
          topTrackListenedMs,
          topTrackKey: "top",
        },
      ],
    ]);
  }

  it("measures concentration on listening rather than on plays", () => {
    // 20 short plays and one long set: spread by plays, concentrated by time.
    const result = factor(
      splitDistribution(21, 20, 5_400_000 + 20 * 180_000, 5_400_000)
    );

    expect(result[0].topTrackShare).toBeCloseTo(0.6, 5);
  });

  it("keeps the evidence gate on plays, not on milliseconds", () => {
    const result = factor(splitDistribution(2, 2, 7_200_000, 7_200_000), {
      minPlays: 5,
    });

    expect(result[0].viewCount).toBe(200);
    expect(result[0].topTrackShare).toBeUndefined();
  });

  it("penalises an artist whose plays sit on one track", () => {
    const result = factor(distributions(200, 200, 1));
    expect(result[0].viewCount).toBe(100);
    expect(result[0].topTrackShare).toBe(1);
    expect(result[0].distributionFactor).toBe(0.5);
  });

  it("barely touches an artist whose plays are spread wide", () => {
    const result = factor(distributions(200, 8, 40));
    expect(result[0].viewCount).toBeCloseTo(196, 5);
    expect(result[0].distinctTracksPlayed).toBe(40);
  });

  it("keeps the full penalty when the ratings sit on the concentrated track", () => {
    const result = factor(distributions(200, 200, 1), {}, ratings(0));
    expect(result[0].distributionFactor).toBe(0.5);
    expect(result[0].ratingBreadth).toBe(0);
  });

  it("lifts the penalty when the ratings spread across the catalogue", () => {
    const result = factor(distributions(200, 200, 1), {}, ratings(1));
    expect(result[0].distributionFactor).toBe(1);
    expect(result[0].viewCount).toBe(200);
    expect(result[0].ratingBreadth).toBe(1);
  });

  it("scales the penalty by partial rating breadth", () => {
    const result = factor(distributions(200, 200, 1), {}, ratings(0.5));
    expect(result[0].distributionFactor).toBeCloseTo(0.75, 10);
  });

  it("is a no-op at weight 0", () => {
    const result = factor(distributions(200, 200, 1), {
      distributionWeight: 0,
    });
    expect(result).toEqual(plays);
  });

  it("leaves artists below the minimum play count alone", () => {
    const result = factor(distributions(3, 3, 1));
    expect(result[0]).toEqual({ name: "A", viewCount: 200 });
  });

  it("leaves artists with no track-level distribution alone", () => {
    const result = factor(new Map());
    expect(result[0]).toEqual({ name: "A", viewCount: 200 });
  });

  it("never divides by zero on a zero-play distribution", () => {
    const result = factor(distributions(0, 0, 0), { minPlays: 0 });
    expect(result[0]).toEqual({ name: "A", viewCount: 200 });
  });

  it("exempts an artist the library holds too few tracks by", () => {
    const result = factor(
      distributions(200, 200, 1),
      { minAvailableTracks: 3 },
      noRatings,
      new Map([["A", 2]])
    );
    expect(result[0]).toEqual({
      name: "A",
      viewCount: 200,
      availableTracks: 2,
    });
  });

  it("still discounts an artist whose unplayed catalogue is large", () => {
    const result = factor(
      distributions(200, 200, 1),
      { minAvailableTracks: 3 },
      noRatings,
      new Map([["A", 12]])
    );
    expect(result[0].distributionFactor).toBe(0.5);
    expect(result[0].availableTracks).toBe(12);
  });

  it("discounts as before when no catalogue capture covers the artist", () => {
    const result = factor(distributions(200, 200, 1), {
      minAvailableTracks: 3,
    });
    expect(result[0].distributionFactor).toBe(0.5);
    expect(result[0].availableTracks).toBeUndefined();
  });

  it("still exempts a two-track long-form artist once concentration is on listening", () => {
    // Two 90-minute sets: half the listening sits on one of them, but with nothing else in
    // the library to play, that is not a one-hit habit.
    const result = factor(
      splitDistribution(6, 3, 6 * 5_400_000, 3 * 5_400_000),
      { minAvailableTracks: 3 },
      noRatings,
      new Map([["A", 2]])
    );

    expect(result[0].viewCount).toBe(200);
    expect(result[0].availableTracks).toBe(2);
  });

  it("turns the exemption off at a threshold of 0", () => {
    const result = factor(
      distributions(200, 200, 1),
      { minAvailableTracks: 0 },
      noRatings,
      new Map([["A", 1]])
    );
    expect(result[0].distributionFactor).toBe(0.5);
  });
});

function albumEvent(
  albums: { ratingKey: string; artistName: string; trackCount: number }[],
  daysAgo = 0
): UserSignalEvent {
  return {
    id: 0,
    user_id: 1,
    kind: "plex_album_tracks",
    payload: JSON.stringify({
      albums: albums.map((album) => ({
        ratingKey: album.ratingKey,
        title: `alb${album.ratingKey}`,
        artistKey: `ak-${album.artistName}`,
        artistName: album.artistName,
        trackCount: album.trackCount,
      })),
    }),
    recorded_at: new Date(NOW - daysAgo * DAY).toISOString(),
  } as UserSignalEvent;
}

describe("deriveTrackAvailability", () => {
  it("sums the catalogue capture across an artist's albums", () => {
    const available = deriveTrackAvailability(
      [
        albumEvent([
          { ratingKey: "a1", artistName: "A", trackCount: 9 },
          { ratingKey: "a2", artistName: "A", trackCount: 3 },
          { ratingKey: "b1", artistName: "B", trackCount: 1 },
        ]),
      ],
      new Map(),
      []
    );
    expect(available.get("A")).toBe(12);
    expect(available.get("B")).toBe(1);
  });

  it("floors availability at the tracks already known to have been played", () => {
    const tracks = deriveWindowedTrackPlays(
      [
        trackEvent(
          [
            { ratingKey: "1", artistName: "A", playCount: 5 },
            { ratingKey: "2", artistName: "A", playCount: 1 },
          ],
          0
        ),
      ],
      null
    );
    const available = deriveTrackAvailability([], tracks, []);
    expect(available.get("A")).toBe(2);
  });

  it("counts a rated track absent from the play fold as proof of another track", () => {
    const tracks = deriveWindowedTrackPlays(
      [trackEvent([{ ratingKey: "1", artistName: "A", playCount: 5 }], 0)],
      null
    );
    const available = deriveTrackAvailability([], tracks, [
      ratingEvent("A", 10, { ratingKey: "unplayed" }),
    ]);
    expect(available.get("A")).toBe(2);
  });

  it("takes the capture when it is larger than what the other series prove", () => {
    const tracks = deriveWindowedTrackPlays(
      [trackEvent([{ ratingKey: "1", artistName: "A", playCount: 5 }], 0)],
      null
    );
    const available = deriveTrackAvailability(
      [albumEvent([{ ratingKey: "a1", artistName: "A", trackCount: 14 }])],
      tracks,
      []
    );
    expect(available.get("A")).toBe(14);
  });

  it("keeps the last known count for an album that later deltas stop mentioning", () => {
    const available = deriveTrackAvailability(
      [
        albumEvent([{ ratingKey: "a1", artistName: "A", trackCount: 9 }], 10),
        albumEvent([{ ratingKey: "a2", artistName: "A", trackCount: 2 }], 0),
      ],
      new Map(),
      []
    );
    expect(available.get("A")).toBe(11);
  });
});

function clearedRatingEvent(
  ratingKey: string,
  artist: string,
  rating: number
): UserSignalEvent {
  return {
    id: 0,
    user_id: 1,
    kind: "plex_rating",
    payload: JSON.stringify({
      ratingKey,
      kind: "track",
      title: "t",
      artist,
      rating,
    }),
    recorded_at: "2026-01-01T00:00:00.000Z",
  } as UserSignalEvent;
}

describe("aggregateArtistRatings", () => {
  const twoTracks = [
    trackEvent(
      [
        { ratingKey: "1", artistName: "A", playCount: 90 },
        { ratingKey: "2", artistName: "A", playCount: 10 },
      ],
      0
    ),
  ];

  it("averages rated items evenly when none of them was played", () => {
    const ratings = ratingsFor(
      [],
      [ratingEvent("A", 10), ratingEvent("A", 6), ratingEvent("B", 8)]
    );
    expect(ratings.get("A")?.rating).toBe(8);
    expect(ratings.get("B")?.rating).toBe(8);
  });

  it("weights each rated track by the plays it holds", () => {
    const ratings = ratingsFor(twoTracks, [
      ratingEvent("A", 10, { ratingKey: "1" }),
      ratingEvent("A", 2, { ratingKey: "2" }),
    ]);
    expect(ratings.get("A")?.rating).toBeCloseTo((10 * 91 + 2 * 11) / 102, 10);
  });

  it("reports no breadth when only the artist's top track is rated", () => {
    const ratings = ratingsFor(twoTracks, [
      ratingEvent("A", 10, { ratingKey: "1" }),
    ]);
    expect(ratings.get("A")?.breadth).toBe(0);
  });

  it("reports full breadth when the rated track is not the top one", () => {
    const ratings = ratingsFor(twoTracks, [
      ratingEvent("A", 10, { ratingKey: "2" }),
    ]);
    expect(ratings.get("A")?.breadth).toBe(1);
  });

  it("spreads an album rating over the plays its tracks hold", () => {
    const ratings = ratingsFor(twoTracks, [
      ratingEvent("A", 10, { ratingKey: "alb-A", kind: "album" }),
    ]);
    expect(ratings.get("A")?.rating).toBe(10);
    expect(ratings.get("A")?.breadth).toBeCloseTo(10.1 / 101, 10);
  });

  it("takes the artist from the joined track, not the payload's name", () => {
    const ratings = ratingsFor(twoTracks, [
      ratingEvent("Stale Name", 10, { ratingKey: "1" }),
    ]);
    expect(ratings.get("A")?.rating).toBe(10);
    expect(ratings.has("Stale Name")).toBe(false);
  });

  it("excludes items whose latest rating is 0 (un-rated)", () => {
    const ratings = ratingsFor(
      [],
      [
        clearedRatingEvent("a1", "A", 10),
        clearedRatingEvent("a1", "A", 0),
        clearedRatingEvent("b1", "B", 8),
      ]
    );
    expect(ratings.has("A")).toBe(false);
    expect(ratings.get("B")?.rating).toBe(8);
  });
});

describe("applyRatingMultiplier", () => {
  it("boosts rated artists and leaves unrated untouched", () => {
    const plays: ArtistWeight[] = [
      { name: "A", viewCount: 100 },
      { name: "B", viewCount: 100 },
    ];
    const ratings = new Map<string, ArtistRatingSignal>([
      ["A", { rating: 10, breadth: 0 }],
    ]);
    const result = applyRatingMultiplier(plays, ratings, 0.5);
    expect(result[0]).toEqual({
      name: "A",
      viewCount: 150,
      ratingMultiplier: 1.5,
    });
    expect(result[1]).toEqual({ name: "B", viewCount: 100 });
  });
});

describe("deriveAlbumWeights", () => {
  function episode(
    ratingKey: string,
    artistName: string,
    albumKey: string,
    daysAgo: number,
    listenedMs: number
  ) {
    return {
      ratingKey,
      title: `t${ratingKey}`,
      artistKey: `ak-${artistName}`,
      artistName,
      albumKey,
      albumTitle: albumKey,
      startedAt: NOW - daysAgo * DAY,
      durationMs: listenedMs,
      listenedMs,
      measured: false,
    };
  }

  function bundle(overrides: Partial<SignalBundle> = {}): SignalBundle {
    return {
      trackEvents: [],
      legacyEvents: [],
      ratingEvents: [],
      albumEvents: [],
      episodes: new Map(),
      ...overrides,
    };
  }

  it("splits an artist's window across their albums from the count deltas", () => {
    const albums = deriveAlbumWeights(
      bundle({
        trackEvents: [
          trackEvent(
            [
              {
                ratingKey: "1",
                artistName: "A",
                albumKey: "acoustic",
                playCount: 2,
              },
              {
                ratingKey: "2",
                artistName: "A",
                albumKey: "loud",
                playCount: 4,
              },
            ],
            60
          ),
          trackEvent(
            [
              {
                ratingKey: "1",
                artistName: "A",
                albumKey: "acoustic",
                playCount: 3,
              },
              {
                ratingKey: "2",
                artistName: "A",
                albumKey: "loud",
                playCount: 13,
              },
            ],
            1
          ),
        ],
      }),
      weightOptions()
    );

    const byKey = new Map(albums.map((a) => [a.albumKey, a.playCount]));
    expect(byKey.get("acoustic")).toBe(1);
    expect(byKey.get("loud")).toBe(9);
  });

  it("takes the window from the episodes when history covers it", () => {
    const albums = deriveAlbumWeights(
      bundle({
        trackEvents: [
          trackEvent(
            [
              {
                ratingKey: "1",
                artistName: "A",
                albumKey: "loud",
                playCount: 40,
              },
            ],
            60
          ),
        ],
        episodes: new Map([
          ["e0", episode("1", "A", "loud", 40, 210_000)],
          ["e1", episode("2", "A", "quiet", 10, 630_000)],
        ]),
      }),
      weightOptions()
    );

    expect(albums).toEqual([
      expect.objectContaining({
        albumKey: "quiet",
        playCount: 1,
        listenedMs: 630_000,
      }),
    ]);
  });

  it("falls back to cumulative totals when the series is shallower than the window", () => {
    const albums = deriveAlbumWeights(
      bundle({
        trackEvents: [
          trackEvent(
            [
              {
                ratingKey: "1",
                artistName: "A",
                albumKey: "loud",
                playCount: 7,
              },
            ],
            2
          ),
        ],
      }),
      weightOptions()
    );

    expect(albums[0]).toMatchObject({ albumKey: "loud", playCount: 7 });
  });

  it("caps a long track the same way the artist weights do", () => {
    const albums = deriveAlbumWeights(
      bundle({
        trackEvents: [
          trackEvent(
            [
              {
                ratingKey: "1",
                artistName: "A",
                albumKey: "sets",
                playCount: 2,
                durationMs: 3_600_000,
              },
            ],
            2
          ),
        ],
      }),
      weightOptions({ maxTrackMinutesForWeight: 10 })
    );

    expect(albums[0].listenedMs).toBe(1_200_000);
  });
});

describe("loadArtistWeights (with DB)", () => {
  beforeEach(async () => {
    await initializeDatabase(":memory:");
    await getDataSource().query("INSERT INTO users (username) VALUES (?)", [
      "alice",
    ]);
  });
  afterEach(async () => {
    vi.clearAllMocks();
    await closeDatabase();
  });

  it("ingests a track-plays capture on demand when the user has none", async () => {
    mockGetAllTrackPlayCounts.mockResolvedValue([
      {
        ratingKey: "1",
        title: "t1",
        artistKey: "ak",
        artistName: "A",
        albumKey: "alb",
        albumTitle: "Album",
        viewCount: 42,
      },
    ]);

    const result = await loadArtistWeights(1, "tok", weightOptions());

    expect(mockGetAllTrackPlayCounts).toHaveBeenCalledWith("tok");
    expect(await getSignalEvents(1, "plex_track_plays")).toHaveLength(1);
    expect(result).toEqual([{ name: "A", viewCount: 42 }]);
  });

  it("weights a long set above a short single at equal play counts", async () => {
    await appendSignalEvent(1, "plex_track_plays", {
      tracks: [
        {
          ratingKey: "set",
          title: "Antwerp Expo",
          artistKey: "ak-dj",
          artistName: "DJ",
          albumKey: "alb-dj",
          albumTitle: "Live",
          playCount: 3,
          durationMs: 5_400_000,
        },
        {
          ratingKey: "single",
          title: "Air",
          artistKey: "ak-pop",
          artistName: "Pop",
          albumKey: "alb-pop",
          albumTitle: "Album",
          playCount: 3,
          durationMs: 180_000,
        },
      ],
    });

    const result = await loadArtistWeights(1, "tok", weightOptions());
    const byName = new Map(result.map((w) => [w.name, w.viewCount]));

    expect(byName.get("DJ")).toBeGreaterThan(byName.get("Pop") ?? 0);
    expect(byName.get("DJ")).toBeCloseTo((3 * 5_400_000) / NOMINAL_TRACK_MS, 5);
  });

  it("ranks the two the same when weighting on plays instead", async () => {
    await appendSignalEvent(1, "plex_track_plays", {
      tracks: [
        {
          ratingKey: "set",
          title: "Antwerp Expo",
          artistKey: "ak-dj",
          artistName: "DJ",
          albumKey: "alb-dj",
          albumTitle: "Live",
          playCount: 3,
          durationMs: 5_400_000,
        },
        {
          ratingKey: "single",
          title: "Air",
          artistKey: "ak-pop",
          artistName: "Pop",
          albumKey: "alb-pop",
          albumTitle: "Album",
          playCount: 3,
          durationMs: 180_000,
        },
      ],
    });

    const result = await loadArtistWeights(
      1,
      "tok",
      weightOptions({ listeningWeight: 0 })
    );

    expect(result.map((w) => w.viewCount)).toEqual([3, 3]);
  });

  it("takes measured listening over the estimate for the same play", async () => {
    const startedAt = NOW - 10 * DAY;
    await appendSignalEvent(1, "plex_track_plays", {
      tracks: [
        {
          ratingKey: "set",
          title: "Antwerp Expo",
          artistKey: "ak-dj",
          artistName: "DJ",
          albumKey: "alb-dj",
          albumTitle: "Live",
          playCount: 1,
          durationMs: 5_400_000,
        },
      ],
    });
    await appendSignalEvent(1, "plex_listen_history", {
      episodes: [
        // Reaches back past the window, which is what makes history authoritative for it.
        {
          ratingKey: "old",
          title: "Air",
          artistKey: "ak-pop",
          artistName: "Pop",
          albumKey: "alb-pop",
          albumTitle: "Album",
          viewedAt: Math.round((NOW - 40 * DAY) / 1000),
          startedAt: NOW - 40 * DAY,
          durationMs: 180_000,
          listenedMs: 180_000,
          measured: false,
        },
        {
          ratingKey: "set",
          title: "Antwerp Expo",
          artistKey: "ak-dj",
          artistName: "DJ",
          albumKey: "alb-dj",
          albumTitle: "Live",
          viewedAt: Math.round((startedAt + 2_700_000) / 1000),
          startedAt,
          durationMs: 5_400_000,
          listenedMs: 5_400_000,
          measured: false,
        },
      ],
    });
    await appendSignalEvent(1, "plex_listen_sessions", {
      episodes: [
        {
          ratingKey: "set",
          title: "Antwerp Expo",
          artistKey: "ak-dj",
          artistName: "DJ",
          albumKey: "alb-dj",
          albumTitle: "Live",
          startedAt,
          durationMs: 5_400_000,
          listenedMs: 720_000,
          measured: true,
        },
      ],
    });

    const result = await loadArtistWeights(1, "tok", weightOptions());
    const dj = result.find((weight) => weight.name === "DJ");

    expect(dj?.viewCount).toBeCloseTo(720_000 / NOMINAL_TRACK_MS, 5);
  });

  it("stays on the count series when history starts inside the window", async () => {
    await appendSignalEvent(1, "plex_track_plays", {
      tracks: [
        {
          ratingKey: "set",
          title: "Antwerp Expo",
          artistKey: "ak-dj",
          artistName: "DJ",
          albumKey: "alb-dj",
          albumTitle: "Live",
          playCount: 1,
          durationMs: 5_400_000,
        },
      ],
    });
    await appendSignalEvent(1, "plex_listen_history", {
      episodes: [
        {
          ratingKey: "set",
          title: "Antwerp Expo",
          artistKey: "ak-dj",
          artistName: "DJ",
          albumKey: "alb-dj",
          albumTitle: "Live",
          viewedAt: Math.round((NOW - 10 * DAY) / 1000),
          startedAt: NOW - 10 * DAY,
          durationMs: 5_400_000,
          listenedMs: 5_400_000,
          measured: false,
        },
      ],
    });

    const result = await loadArtistWeights(1, "tok", weightOptions());

    expect(result[0].viewCount).toBeCloseTo(5_400_000 / NOMINAL_TRACK_MS, 5);
  });

  it("does not fetch live when only a legacy series exists", async () => {
    await appendSignalEvent(1, "plex_plays", {
      artists: [{ name: "A", playCount: 100 }],
    });

    const result = await loadArtistWeights(1, "tok", weightOptions());

    expect(mockGetAllTrackPlayCounts).not.toHaveBeenCalled();
    expect(result).toEqual([{ name: "A", viewCount: 100 }]);
  });

  it("drops Various Artists from the weight set", async () => {
    await appendSignalEvent(1, "plex_track_plays", {
      tracks: [
        {
          ratingKey: "1",
          title: "t1",
          artistKey: "va",
          artistName: "Various Artists",
          albumKey: "alb1",
          albumTitle: "Comp",
          playCount: 900,
        },
        {
          ratingKey: "2",
          title: "t2",
          artistKey: "ak",
          artistName: "A",
          albumKey: "alb2",
          albumTitle: "Album",
          playCount: 10,
        },
      ],
    });

    const result = await loadArtistWeights(1, "tok", weightOptions());

    expect(result).toEqual([{ name: "A", viewCount: 10 }]);
  });

  it("applies the distribution factor to a one-hit artist", async () => {
    await appendSignalEvent(1, "plex_track_plays", {
      tracks: [
        {
          ratingKey: "1",
          title: "hit",
          artistKey: "ak",
          artistName: "A",
          albumKey: "alb",
          albumTitle: "Album",
          playCount: 100,
        },
        {
          ratingKey: "2",
          title: "deep cut",
          artistKey: "ak",
          artistName: "A",
          albumKey: "alb",
          albumTitle: "Album",
          playCount: 0,
        },
      ],
    });

    const result = await loadArtistWeights(
      1,
      "tok",
      weightOptions({ ratingWeight: 0, distributionWeight: 0.5 })
    );

    expect(result).toEqual([
      {
        name: "A",
        viewCount: 50,
        distinctTracksPlayed: 1,
        topTrackShare: 1,
        distributionFactor: 0.5,
        availableTracks: 2,
      },
    ]);
  });

  it("reads existing track plays + ratings without a live fetch", async () => {
    await appendSignalEvent(1, "plex_track_plays", {
      tracks: [
        {
          ratingKey: "1",
          title: "t1",
          artistKey: "ak",
          artistName: "A",
          albumKey: "alb",
          albumTitle: "Album",
          playCount: 100,
        },
      ],
    });
    await appendSignalEvent(1, "plex_rating", {
      ratingKey: "k",
      kind: "track",
      title: "t",
      artist: "A",
      rating: 10,
    });

    const result = await loadArtistWeights(1, "tok", weightOptions());

    expect(mockGetAllTrackPlayCounts).not.toHaveBeenCalled();
    expect(result).toEqual([
      { name: "A", viewCount: 150, ratingMultiplier: 1.5 },
    ]);
  });

  it("lets a rating on the deep cut refute the one-hit discount", async () => {
    await appendSignalEvent(1, "plex_track_plays", {
      tracks: [
        {
          ratingKey: "hit",
          title: "Hit",
          artistKey: "ak",
          artistName: "A",
          albumKey: "alb",
          albumTitle: "Album",
          playCount: 90,
        },
        {
          ratingKey: "deep",
          title: "Deep Cut",
          artistKey: "ak",
          artistName: "A",
          albumKey: "alb",
          albumTitle: "Album",
          playCount: 10,
        },
      ],
    });
    await appendSignalEvent(1, "plex_rating", {
      ratingKey: "deep",
      kind: "track",
      title: "Deep Cut",
      artist: "A",
      rating: 10,
    });

    const [artist] = await loadArtistWeights(
      1,
      "tok",
      weightOptions({ ratingWeight: 0, distributionWeight: 0.5 })
    );

    expect(artist.topTrackShare).toBeCloseTo(0.9, 10);
    expect(artist.ratingBreadth).toBe(1);
    expect(artist.distributionFactor).toBe(1);
  });

  it("exempts a singles-only artist from the one-hit discount", async () => {
    await appendSignalEvent(1, "plex_track_plays", {
      tracks: [
        {
          ratingKey: "1",
          title: "The Single",
          artistKey: "ak",
          artistName: "A",
          albumKey: "alb",
          albumTitle: "Single",
          playCount: 100,
        },
      ],
    });
    await appendSignalEvent(1, "plex_album_tracks", {
      albums: [
        {
          ratingKey: "alb",
          title: "Single",
          artistKey: "ak",
          artistName: "A",
          trackCount: 1,
        },
      ],
    });

    const [artist] = await loadArtistWeights(
      1,
      "tok",
      weightOptions({
        ratingWeight: 0,
        distributionWeight: 0.5,
        minAvailableTracksForDistribution: 3,
      })
    );

    expect(artist.availableTracks).toBe(1);
    expect(artist.distributionFactor).toBeUndefined();
    expect(artist.viewCount).toBe(100);
  });

  it("still discounts a one-hit artist whose catalogue is deep", async () => {
    await appendSignalEvent(1, "plex_track_plays", {
      tracks: [
        {
          ratingKey: "1",
          title: "The Hit",
          artistKey: "ak",
          artistName: "A",
          albumKey: "alb",
          albumTitle: "Album",
          playCount: 100,
        },
      ],
    });
    await appendSignalEvent(1, "plex_album_tracks", {
      albums: [
        {
          ratingKey: "alb",
          title: "Album",
          artistKey: "ak",
          artistName: "A",
          trackCount: 12,
        },
      ],
    });

    const [artist] = await loadArtistWeights(
      1,
      "tok",
      weightOptions({
        ratingWeight: 0,
        distributionWeight: 0.5,
        minAvailableTracksForDistribution: 3,
      })
    );

    expect(artist.availableTracks).toBe(12);
    expect(artist.distributionFactor).toBe(0.5);
    expect(artist.viewCount).toBe(50);
  });

  it("keeps the one-hit discount when the hit itself is the rated track", async () => {
    await appendSignalEvent(1, "plex_track_plays", {
      tracks: [
        {
          ratingKey: "hit",
          title: "Hit",
          artistKey: "ak",
          artistName: "A",
          albumKey: "alb",
          albumTitle: "Album",
          playCount: 90,
        },
        {
          ratingKey: "deep",
          title: "Deep Cut",
          artistKey: "ak",
          artistName: "A",
          albumKey: "alb",
          albumTitle: "Album",
          playCount: 10,
        },
      ],
    });
    await appendSignalEvent(1, "plex_rating", {
      ratingKey: "hit",
      kind: "track",
      title: "Hit",
      artist: "A",
      rating: 10,
    });

    const [artist] = await loadArtistWeights(
      1,
      "tok",
      weightOptions({ ratingWeight: 0, distributionWeight: 0.5 })
    );

    expect(artist.ratingBreadth).toBe(0);
    expect(artist.distributionFactor).toBeCloseTo(0.55, 10);
  });
});
