import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetAllTrackPlayCounts = vi.fn();

vi.mock("../api/plex/trackPlayCounts", () => ({
  getAllTrackPlayCounts: (...args: unknown[]) =>
    mockGetAllTrackPlayCounts(...args),
}));

import {
  derivePlayWeights,
  deriveWindowedTrackPlays,
  deriveArtistDistributions,
  applyDistributionFactor,
  reconstructArtistPlayCounts,
  aggregateArtistRatings,
  applyRatingMultiplier,
  loadArtistWeights,
  type ArtistRatingSignal,
  type ArtistWeight,
  type ArtistWeightOptions,
} from "./artistWeights";
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
};

const DAY = 24 * 60 * 60 * 1000;

function weightOptions(overrides: Partial<ArtistWeightOptions> = {}) {
  return {
    windowMs: 30 * DAY,
    ratingWeight: 0.5,
    distributionWeight: 0,
    minPlaysForDistribution: 5,
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

describe("reconstructArtistPlayCounts", () => {
  it("accumulates track plays into per-artist totals", () => {
    const counts = reconstructArtistPlayCounts(
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
    expect(counts.get("A")).toBe(10);
    expect(counts.get("B")).toBe(2);
  });

  it("groups by artistKey so a rename keeps one bucket", () => {
    const counts = reconstructArtistPlayCounts(
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
    expect([...counts.values()]).toEqual([8]);
  });

  it("keeps same-named artists separate when their keys differ", () => {
    const counts = reconstructArtistPlayCounts(
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
    expect(counts.get("Nova")).toBe(5);
  });

  it("takes the higher of the two series per artist", () => {
    const counts = reconstructArtistPlayCounts(
      [trackEvent([{ ratingKey: "1", artistName: "A", playCount: 4 }], 0)],
      [legacyEvent([{ name: "A", playCount: 30 }], 0)],
      Infinity
    );
    expect(counts.get("A")).toBe(30);
  });

  it("ignores events recorded after the cutoff", () => {
    const counts = reconstructArtistPlayCounts(
      [
        trackEvent([{ ratingKey: "1", artistName: "A", playCount: 4 }], 40),
        trackEvent([{ ratingKey: "1", artistName: "A", playCount: 90 }], 0),
      ],
      [],
      NOW - 30 * DAY
    );
    expect(counts.get("A")).toBe(4);
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
    const result = derivePlayWeights(trackEvents, [], NOW, 30 * DAY);
    expect(result.weights).toEqual([{ name: "A", viewCount: 20 }]);
    expect(result.windowStart).toBe(NOW - 30 * DAY);
  });

  it("falls back to latest all-time counts until the window is covered", () => {
    const trackEvents = [
      trackEvent([{ ratingKey: "1", artistName: "A", playCount: 10 }], 5),
      trackEvent([{ ratingKey: "1", artistName: "A", playCount: 12 }], 0),
    ];
    const result = derivePlayWeights(trackEvents, [], NOW, 30 * DAY);
    expect(result.weights).toEqual([{ name: "A", viewCount: 12 }]);
    expect(result.windowStart).toBeNull();
  });

  it("falls back to all-time when nothing was played in the window", () => {
    const trackEvents = [
      trackEvent([{ ratingKey: "1", artistName: "A", playCount: 10 }], 40),
      trackEvent([{ ratingKey: "1", artistName: "A", playCount: 10 }], 0),
    ];
    const result = derivePlayWeights(trackEvents, [], NOW, 30 * DAY);
    expect(result.weights).toEqual([{ name: "A", viewCount: 10 }]);
    expect(result.windowStart).toBeNull();
  });

  it("returns empty when neither series has captures", () => {
    expect(derivePlayWeights([], [], NOW, 30 * DAY)).toEqual({
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
    const result = derivePlayWeights([], legacyEvents, NOW, 30 * DAY);
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
    const result = derivePlayWeights(trackEvents, legacyEvents, NOW, 30 * DAY);
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
    const result = derivePlayWeights(trackEvents, legacyEvents, NOW, 30 * DAY);
    expect(result.windowStart).toBe(NOW - 30 * DAY);
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
});

describe("applyDistributionFactor", () => {
  const plays: ArtistWeight[] = [{ name: "A", viewCount: 200 }];
  const noRatings = new Map<string, ArtistRatingSignal>();

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
          distinctTracksPlayed,
          topTrackPlayCount,
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

  it("penalises an artist whose plays sit on one track", () => {
    const result = applyDistributionFactor(
      plays,
      distributions(200, 200, 1),
      noRatings,
      0.5,
      5
    );
    expect(result[0].viewCount).toBe(100);
    expect(result[0].topTrackShare).toBe(1);
    expect(result[0].distributionFactor).toBe(0.5);
  });

  it("barely touches an artist whose plays are spread wide", () => {
    const result = applyDistributionFactor(
      plays,
      distributions(200, 8, 40),
      noRatings,
      0.5,
      5
    );
    expect(result[0].viewCount).toBeCloseTo(196, 5);
    expect(result[0].distinctTracksPlayed).toBe(40);
  });

  it("keeps the full penalty when the ratings sit on the concentrated track", () => {
    const result = applyDistributionFactor(
      plays,
      distributions(200, 200, 1),
      ratings(0),
      0.5,
      5
    );
    expect(result[0].distributionFactor).toBe(0.5);
    expect(result[0].ratingBreadth).toBe(0);
  });

  it("lifts the penalty when the ratings spread across the catalogue", () => {
    const result = applyDistributionFactor(
      plays,
      distributions(200, 200, 1),
      ratings(1),
      0.5,
      5
    );
    expect(result[0].distributionFactor).toBe(1);
    expect(result[0].viewCount).toBe(200);
    expect(result[0].ratingBreadth).toBe(1);
  });

  it("scales the penalty by partial rating breadth", () => {
    const result = applyDistributionFactor(
      plays,
      distributions(200, 200, 1),
      ratings(0.5),
      0.5,
      5
    );
    expect(result[0].distributionFactor).toBeCloseTo(0.75, 10);
  });

  it("is a no-op at weight 0", () => {
    const result = applyDistributionFactor(
      plays,
      distributions(200, 200, 1),
      noRatings,
      0,
      5
    );
    expect(result).toEqual(plays);
  });

  it("leaves artists below the minimum play count alone", () => {
    const result = applyDistributionFactor(
      plays,
      distributions(3, 3, 1),
      noRatings,
      0.5,
      5
    );
    expect(result[0]).toEqual({ name: "A", viewCount: 200 });
  });

  it("leaves artists with no track-level distribution alone", () => {
    const result = applyDistributionFactor(plays, new Map(), noRatings, 0.5, 5);
    expect(result[0]).toEqual({ name: "A", viewCount: 200 });
  });

  it("never divides by zero on a zero-play distribution", () => {
    const result = applyDistributionFactor(
      plays,
      distributions(0, 0, 0),
      noRatings,
      0.5,
      0
    );
    expect(result[0]).toEqual({ name: "A", viewCount: 200 });
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
