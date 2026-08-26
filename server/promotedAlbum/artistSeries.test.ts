import { describe, it, expect } from "vitest";

import {
  MOMENTUM_MAX,
  attachSeriesSignals,
  bucketWindows,
  coverageIndex,
  deriveArtistSeries,
  selectProfileSeries,
  type ArtistSeries,
  type ArtistSeriesOptions,
} from "./artistSeries";
import { NOMINAL_TRACK_MS } from "../services/profile/signalIngestion";
import type { ListenEpisode } from "../services/profile/listenHistory";
import type { UserSignalEvent } from "../db/entity/UserSignalEvent";
import type { ArtistWeight } from "./artistWeights";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const NOW = 1_700_000_000_000;

const OPTIONS: ArtistSeriesOptions = {
  now: NOW,
  bucketMs: WEEK_MS,
  spanMs: 4 * WEEK_MS,
  recentBuckets: 1,
  capMs: 0,
  listeningWeight: 1,
};

/** An episode started `weeksAgo` before the last bucket's end, so it lands where intended. */
function episode(
  artistName: string,
  weeksAgo: number,
  overrides: Partial<ListenEpisode> = {}
): ListenEpisode {
  const startedAt = NOW - weeksAgo * WEEK_MS - 1;
  return {
    ratingKey: `${artistName}-${weeksAgo}-${overrides.listenedMs ?? "d"}`,
    title: "track",
    artistKey: `key-${artistName}`,
    artistName,
    albumKey: "album",
    albumTitle: "Album",
    startedAt,
    durationMs: NOMINAL_TRACK_MS,
    listenedMs: NOMINAL_TRACK_MS,
    measured: false,
    ...overrides,
  };
}

function episodes(rows: ListenEpisode[]): Map<string, ListenEpisode> {
  return new Map(rows.map((e) => [e.ratingKey, e]));
}

function trackEvent(
  recordedAt: number,
  tracks: { ratingKey: string; artistName: string; playCount: number }[]
): UserSignalEvent {
  return {
    id: recordedAt,
    user_id: 1,
    kind: "plex_track_plays",
    recorded_at: new Date(recordedAt).toISOString(),
    payload: JSON.stringify({
      tracks: tracks.map((t) => ({
        ratingKey: t.ratingKey,
        title: t.ratingKey,
        artistKey: `key-${t.artistName}`,
        artistName: t.artistName,
        albumKey: "album",
        albumTitle: "Album",
        playCount: t.playCount,
        durationMs: NOMINAL_TRACK_MS,
      })),
    }),
  } as UserSignalEvent;
}

const seriesFor = (all: ArtistSeries[], name: string): ArtistSeries => {
  const found = all.find((s) => s.name === name);
  if (!found) throw new Error(`no series for ${name}`);
  return found;
};

describe("bucketWindows", () => {
  it("ends the last bucket at now rather than on a calendar boundary", () => {
    const windows = bucketWindows(NOW, 4 * WEEK_MS, WEEK_MS);

    expect(windows).toHaveLength(4);
    expect(windows[3].endMs).toBe(NOW);
    expect(windows[0].startMs).toBe(NOW - 4 * WEEK_MS);
  });

  it("returns nothing for a zero or negative span", () => {
    expect(bucketWindows(NOW, 0, WEEK_MS)).toEqual([]);
    expect(bucketWindows(NOW, 4 * WEEK_MS, 0)).toEqual([]);
  });
});

describe("deriveArtistSeries from episodes", () => {
  it("places each episode in the bucket it was played in", () => {
    const series = deriveArtistSeries(
      [],
      episodes([
        episode("Parcels", 0.5),
        episode("Parcels", 0.6),
        episode("Parcels", 2.5),
      ]),
      OPTIONS
    );

    expect(seriesFor(series, "Parcels").buckets.map((b) => b.plays)).toEqual([
      0, 1, 0, 2,
    ]);
  });

  it("keeps buckets with no listening rather than dropping them", () => {
    const series = deriveArtistSeries(
      [],
      episodes([episode("Parcels", 0.5)]),
      OPTIONS
    );

    expect(seriesFor(series, "Parcels").buckets).toHaveLength(4);
    expect(seriesFor(series, "Parcels").buckets[0]).toEqual({
      startMs: NOW - 4 * WEEK_MS,
      plays: 0,
      listenedMs: 0,
    });
  });

  it("ignores episodes outside the span", () => {
    const series = deriveArtistSeries(
      [],
      episodes([episode("Parcels", 9), episode("Parcels", 0.5)]),
      OPTIONS
    );

    const total = seriesFor(series, "Parcels").buckets.reduce(
      (sum, b) => sum + b.plays,
      0
    );
    expect(total).toBe(1);
  });

  it("caps what one play contributes when a cap is set", () => {
    const long = episode("Andromedik", 0.5, { listenedMs: 90 * 60 * 1000 });
    const series = deriveArtistSeries([], episodes([long]), {
      ...OPTIONS,
      capMs: 15 * 60 * 1000,
    });

    expect(seriesFor(series, "Andromedik").buckets[3].listenedMs).toBe(
      15 * 60 * 1000
    );
  });
});

describe("deriveArtistSeries reconciliation", () => {
  it("uses count deltas for buckets the episode log does not reach", () => {
    const events = [
      trackEvent(NOW - 4 * WEEK_MS, [
        { ratingKey: "t1", artistName: "Mac Miller", playCount: 2 },
      ]),
      trackEvent(NOW - 2.5 * WEEK_MS, [
        { ratingKey: "t1", artistName: "Mac Miller", playCount: 6 },
      ]),
    ];

    const series = deriveArtistSeries(events, new Map(), OPTIONS);

    expect(seriesFor(series, "Mac Miller").buckets.map((b) => b.plays)).toEqual(
      [0, 4, 0, 0]
    );
  });

  it("does not count a play twice when both series describe it", () => {
    // History reaches the whole span, so the counts must not contribute at all.
    const events = [
      trackEvent(NOW - 4 * WEEK_MS, [
        { ratingKey: "t1", artistName: "Jesse Welles", playCount: 0 },
      ]),
      trackEvent(NOW - 1.5 * WEEK_MS, [
        { ratingKey: "t1", artistName: "Jesse Welles", playCount: 5 },
      ]),
    ];
    const covered = episodes([
      episode("Jesse Welles", 3.9),
      episode("Jesse Welles", 1.6),
    ]);

    const series = deriveArtistSeries(events, covered, OPTIONS);

    const total = seriesFor(series, "Jesse Welles").buckets.reduce(
      (sum, b) => sum + b.plays,
      0
    );
    expect(total).toBe(2);
  });

  it("splits the span when history only covers its recent end", () => {
    const events = [
      trackEvent(NOW - 4 * WEEK_MS, [
        { ratingKey: "t1", artistName: "Durry", playCount: 1 },
      ]),
      trackEvent(NOW - 3.5 * WEEK_MS, [
        { ratingKey: "t1", artistName: "Durry", playCount: 4 },
      ]),
    ];
    // Coverage starts inside bucket 2, so buckets 0 and 1 come from the counts.
    const partial = episodes([episode("Durry", 1.5), episode("Durry", 0.5)]);

    const series = deriveArtistSeries(events, partial, OPTIONS);

    expect(seriesFor(series, "Durry").buckets.map((b) => b.plays)).toEqual([
      3, 0, 1, 1,
    ]);
  });
});

describe("coverageIndex", () => {
  it("reports the whole span uncovered when there are no episodes", () => {
    const windows = bucketWindows(NOW, 4 * WEEK_MS, WEEK_MS);
    expect(coverageIndex(new Map(), windows)).toBe(windows.length);
  });

  it("hands the bucket coverage begins inside to the episodes", () => {
    const windows = bucketWindows(NOW, 4 * WEEK_MS, WEEK_MS);
    expect(coverageIndex(episodes([episode("A", 2.5)]), windows)).toBe(1);
  });
});

describe("momentum, emergence and decay", () => {
  it("reads a steady artist as neutral momentum", () => {
    const steady = episodes([
      episode("Steady", 3.5),
      episode("Steady", 2.5),
      episode("Steady", 1.5),
      episode("Steady", 0.5),
    ]);

    expect(
      seriesFor(deriveArtistSeries([], steady, OPTIONS), "Steady").momentum
    ).toBe(1);
  });

  it("reads a surge as momentum above one", () => {
    const rising = episodes([
      episode("Rising", 3.5),
      episode("Rising", 0.1),
      episode("Rising", 0.2),
      episode("Rising", 0.3),
      episode("Rising", 0.4),
    ]);

    const series = seriesFor(deriveArtistSeries([], rising, OPTIONS), "Rising");
    expect(series.momentum).toBeGreaterThan(1);
  });

  it("caps momentum for an artist with no earlier listening at all", () => {
    // Another artist from the start of the span is what makes the empty buckets evidence of
    // silence rather than of nothing having been recorded yet.
    const brandNew = episodes([
      episode("Established", 3.5),
      episode("New", 0.5),
      episode("New", 0.4),
    ]);

    const series = seriesFor(deriveArtistSeries([], brandNew, OPTIONS), "New");
    expect(series.momentum).toBe(MOMENTUM_MAX);
    expect(series.emerging).toBe(true);
  });

  it("ignores buckets that predate any recorded listening", () => {
    // Only the last two buckets were ever measured, so the four before them must not drag
    // the baseline to zero and read back as infinite momentum for everyone.
    const late = episodes([
      episode("Late", 1.5),
      episode("Late", 0.5),
      episode("Other", 1.5),
    ]);

    const series = seriesFor(
      deriveArtistSeries([], late, { ...OPTIONS, recentBuckets: 1 }),
      "Late"
    );
    expect(series.momentum).toBe(1);
    expect(series.emerging).toBe(false);
  });

  it("does not call an artist emerging when the span opened on them", () => {
    // First activity in bucket 0 could be an artist already being listened to.
    const fromTheStart = episodes([
      episode("Existing", 3.5),
      episode("Existing", 0.5),
    ]);

    const series = seriesFor(
      deriveArtistSeries([], fromTheStart, OPTIONS),
      "Existing"
    );
    expect(series.emerging).toBe(false);
    expect(series.firstSeenMs).toBe(NOW - 4 * WEEK_MS);
  });

  it("flags an artist that has gone quiet as decaying", () => {
    const gone = episodes([episode("Gone", 3.5), episode("Gone", 2.5)]);

    const series = seriesFor(deriveArtistSeries([], gone, OPTIONS), "Gone");
    expect(series.decaying).toBe(true);
    expect(series.momentum).toBe(0);
  });

  it("claims nothing when there is no trailing baseline to compare against", () => {
    const wideRecent = { ...OPTIONS, recentBuckets: 4 };
    const any = episodes([episode("Any", 0.5)]);

    expect(
      seriesFor(deriveArtistSeries([], any, wideRecent), "Any").momentum
    ).toBe(1);
  });

  it("measures momentum in play-equivalents, so long listens count", () => {
    const longRecent = episodes([
      episode("Sets", 3.5),
      episode("Sets", 0.5, { listenedMs: 10 * NOMINAL_TRACK_MS }),
    ]);

    const byTime = seriesFor(
      deriveArtistSeries([], longRecent, OPTIONS),
      "Sets"
    );
    const byPlays = seriesFor(
      deriveArtistSeries([], longRecent, {
        ...OPTIONS,
        listeningWeight: 0,
      }),
      "Sets"
    );

    expect(byTime.momentum).toBeGreaterThan(byPlays.momentum);
  });
});

describe("attachSeriesSignals", () => {
  const weights: ArtistWeight[] = [
    { name: "Parcels", viewCount: 12 },
    { name: "Unknown", viewCount: 3 },
  ];
  const series: ArtistSeries[] = [
    {
      name: "Parcels",
      buckets: [],
      firstSeenMs: 42,
      momentum: 2.5,
      emerging: true,
      decaying: false,
    },
  ];

  it("copies the signals onto the matching weight", () => {
    const [parcels] = attachSeriesSignals(weights, series);

    expect(parcels).toMatchObject({
      momentum: 2.5,
      emerging: true,
      decaying: false,
      firstSeenMs: 42,
    });
  });

  it("leaves the ranking number alone", () => {
    const [parcels] = attachSeriesSignals(weights, series);
    expect(parcels.viewCount).toBe(12);
  });

  it("leaves a weight with no series untouched", () => {
    const [, unknown] = attachSeriesSignals(weights, series);
    expect(unknown).toEqual({ name: "Unknown", viewCount: 3 });
  });
});

describe("selectProfileSeries", () => {
  const build = (name: string, emerging: boolean, momentum: number) => ({
    name,
    buckets: [
      { startMs: NOW - WEEK_MS, plays: 1, listenedMs: 10 },
      { startMs: NOW, plays: 2, listenedMs: 20 },
    ],
    firstSeenMs: NOW - WEEK_MS,
    momentum,
    emerging,
    decaying: false,
  });

  it("flattens buckets into parallel arrays", () => {
    const [row] = selectProfileSeries(
      [build("Ranked", false, 1)],
      ["Ranked"],
      5,
      WEEK_MS
    );

    expect(row).toMatchObject({
      name: "Ranked",
      bucketMs: WEEK_MS,
      startMs: NOW - WEEK_MS,
      plays: [1, 2],
      listenedMs: [10, 20],
    });
  });

  it("keeps the ranked artists in ranked order", () => {
    const rows = selectProfileSeries(
      [build("B", false, 1), build("A", false, 1)],
      ["A", "B"],
      5,
      WEEK_MS
    );

    expect(rows.map((r) => r.name)).toEqual(["A", "B"]);
  });

  it("keeps emerging artists the ranking missed", () => {
    const rows = selectProfileSeries(
      [build("Ranked", false, 1), build("Newcomer", true, 8)],
      ["Ranked"],
      1,
      WEEK_MS
    );

    expect(rows.map((r) => r.name)).toEqual(["Ranked", "Newcomer"]);
  });

  it("does not duplicate an emerging artist that already ranked", () => {
    const rows = selectProfileSeries(
      [build("Both", true, 8)],
      ["Both"],
      5,
      WEEK_MS
    );

    expect(rows.map((r) => r.name)).toEqual(["Both"]);
  });

  it("bounds how many extra emerging artists are kept", () => {
    const emerging = ["E1", "E2", "E3"].map((n) => build(n, true, 5));
    const rows = selectProfileSeries(
      [build("Ranked", false, 1), ...emerging],
      ["Ranked"],
      1,
      WEEK_MS
    );

    expect(rows).toHaveLength(2);
  });
});
