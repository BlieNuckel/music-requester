import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetAllTrackPlayCounts = vi.fn();

vi.mock("../api/plex/trackPlayCounts", () => ({
  getAllTrackPlayCounts: (...args: unknown[]) =>
    mockGetAllTrackPlayCounts(...args),
}));

import {
  derivePlayWeights,
  reconstructArtistPlayCounts,
  aggregateArtistRatings,
  applyRatingMultiplier,
  loadArtistWeights,
  type ArtistWeight,
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

function ratingEvent(artist: string, rating: number): UserSignalEvent {
  return {
    id: 0,
    user_id: 1,
    kind: "plex_rating",
    payload: JSON.stringify({
      ratingKey: `${artist}-${rating}`,
      kind: "track",
      title: "t",
      artist,
      rating,
    }),
    recorded_at: "2026-01-01T00:00:00.000Z",
  } as UserSignalEvent;
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
    expect(result).toEqual([{ name: "A", viewCount: 20 }]);
  });

  it("falls back to latest all-time counts until the window is covered", () => {
    const trackEvents = [
      trackEvent([{ ratingKey: "1", artistName: "A", playCount: 10 }], 5),
      trackEvent([{ ratingKey: "1", artistName: "A", playCount: 12 }], 0),
    ];
    const result = derivePlayWeights(trackEvents, [], NOW, 30 * DAY);
    expect(result).toEqual([{ name: "A", viewCount: 12 }]);
  });

  it("falls back to all-time when nothing was played in the window", () => {
    const trackEvents = [
      trackEvent([{ ratingKey: "1", artistName: "A", playCount: 10 }], 40),
      trackEvent([{ ratingKey: "1", artistName: "A", playCount: 10 }], 0),
    ];
    const result = derivePlayWeights(trackEvents, [], NOW, 30 * DAY);
    expect(result).toEqual([{ name: "A", viewCount: 10 }]);
  });

  it("returns empty when neither series has captures", () => {
    expect(derivePlayWeights([], [], NOW, 30 * DAY)).toEqual([]);
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
    expect(result).toEqual([{ name: "A", viewCount: 20 }]);
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
    expect(result).toEqual([{ name: "A", viewCount: 15 }]);
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
  it("averages ratings per artist from the latest per item", () => {
    const ratings = aggregateArtistRatings([
      ratingEvent("A", 10),
      ratingEvent("A", 6),
      ratingEvent("B", 8),
    ]);
    expect(ratings.get("A")).toBe(8);
    expect(ratings.get("B")).toBe(8);
  });

  it("excludes items whose latest rating is 0 (un-rated)", () => {
    const ratings = aggregateArtistRatings([
      clearedRatingEvent("a1", "A", 10),
      clearedRatingEvent("a1", "A", 0),
      clearedRatingEvent("b1", "B", 8),
    ]);
    expect(ratings.has("A")).toBe(false);
    expect(ratings.get("B")).toBe(8);
  });
});

describe("applyRatingMultiplier", () => {
  it("boosts rated artists and leaves unrated untouched", () => {
    const plays: ArtistWeight[] = [
      { name: "A", viewCount: 100 },
      { name: "B", viewCount: 100 },
    ];
    const ratings = new Map([["A", 10]]);
    const result = applyRatingMultiplier(plays, ratings, 0.5);
    expect(result[0]).toEqual({ name: "A", viewCount: 150 });
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

    const result = await loadArtistWeights(1, "tok", 30 * DAY, 0.5, NOW);

    expect(mockGetAllTrackPlayCounts).toHaveBeenCalledWith("tok");
    expect(await getSignalEvents(1, "plex_track_plays")).toHaveLength(1);
    expect(result).toEqual([{ name: "A", viewCount: 42 }]);
  });

  it("does not fetch live when only a legacy series exists", async () => {
    await appendSignalEvent(1, "plex_plays", {
      artists: [{ name: "A", playCount: 100 }],
    });

    const result = await loadArtistWeights(1, "tok", 30 * DAY, 0.5, NOW);

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

    const result = await loadArtistWeights(1, "tok", 30 * DAY, 0.5, NOW);

    expect(result).toEqual([{ name: "A", viewCount: 10 }]);
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

    const result = await loadArtistWeights(1, "tok", 30 * DAY, 0.5, NOW);

    expect(mockGetAllTrackPlayCounts).not.toHaveBeenCalled();
    expect(result).toEqual([{ name: "A", viewCount: 150 }]);
  });
});
