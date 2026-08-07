import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetAllArtistPlayCounts = vi.fn();

vi.mock("../api/plex/artistPlayCounts", () => ({
  getAllArtistPlayCounts: (...args: unknown[]) =>
    mockGetAllArtistPlayCounts(...args),
}));

import {
  derivePlayWeights,
  aggregateArtistRatings,
  applyRatingMultiplier,
  loadArtistWeights,
  type ArtistWeight,
} from "./artistWeights";
import { initializeDatabase, closeDatabase, getDataSource } from "../db";
import { appendSignalEvent, getSignalEvents } from "../db/userProfile";
import type { UserSignalEvent } from "../db/entity/UserSignalEvent";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-06-28T00:00:00.000Z");

function playsEvent(
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

describe("derivePlayWeights", () => {
  it("returns windowed deltas when the series spans the window", () => {
    const playEvents = [
      playsEvent(
        [
          { name: "A", playCount: 10 },
          { name: "B", playCount: 5 },
        ],
        40
      ),
      playsEvent(
        [
          { name: "A", playCount: 30 },
          { name: "B", playCount: 5 },
        ],
        0
      ),
    ];
    const result = derivePlayWeights(playEvents, NOW, 30 * DAY);
    expect(result).toEqual([{ name: "A", viewCount: 20 }]);
  });

  it("falls back to latest all-time counts until the window is covered", () => {
    const playEvents = [
      playsEvent([{ name: "A", playCount: 10 }], 5),
      playsEvent([{ name: "A", playCount: 12 }], 0),
    ];
    const result = derivePlayWeights(playEvents, NOW, 30 * DAY);
    expect(result).toEqual([{ name: "A", viewCount: 12 }]);
  });

  it("falls back to all-time when nothing was played in the window", () => {
    const playEvents = [
      playsEvent([{ name: "A", playCount: 10 }], 40),
      playsEvent([{ name: "A", playCount: 10 }], 0),
    ];
    const result = derivePlayWeights(playEvents, NOW, 30 * DAY);
    expect(result).toEqual([{ name: "A", viewCount: 10 }]);
  });

  it("returns empty for no plays captures", () => {
    expect(derivePlayWeights([], NOW, 30 * DAY)).toEqual([]);
  });

  it("reconstructs latest and baseline across delta rows", () => {
    const playEvents = [
      playsEvent(
        [
          { name: "A", playCount: 10 },
          { name: "B", playCount: 5 },
        ],
        40
      ),
      playsEvent([{ name: "A", playCount: 30 }], 0),
    ];
    const result = derivePlayWeights(playEvents, NOW, 30 * DAY);
    expect(result).toEqual([{ name: "A", viewCount: 20 }]);
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

  it("ingests a plays capture on demand when the user has none", async () => {
    mockGetAllArtistPlayCounts.mockResolvedValue([
      { name: "A", viewCount: 42 },
    ]);

    const result = await loadArtistWeights(1, "tok", 30 * DAY, 0.5, NOW);

    expect(mockGetAllArtistPlayCounts).toHaveBeenCalledWith("tok");
    expect(await getSignalEvents(1, "plex_plays")).toHaveLength(1);
    expect(result).toEqual([{ name: "A", viewCount: 42 }]);
  });

  it("drops Various Artists from the weight set", async () => {
    await appendSignalEvent(1, "plex_plays", {
      artists: [
        { name: "Various Artists", playCount: 900 },
        { name: "A", playCount: 10 },
      ],
    });

    const result = await loadArtistWeights(1, "tok", 30 * DAY, 0.5, NOW);

    expect(result).toEqual([{ name: "A", viewCount: 10 }]);
  });

  it("reads existing plays + ratings without a live fetch", async () => {
    await appendSignalEvent(1, "plex_plays", {
      artists: [{ name: "A", playCount: 100 }],
    });
    await appendSignalEvent(1, "plex_rating", {
      ratingKey: "k",
      kind: "track",
      title: "t",
      artist: "A",
      rating: 10,
    });

    const result = await loadArtistWeights(1, "tok", 30 * DAY, 0.5, NOW);

    expect(mockGetAllArtistPlayCounts).not.toHaveBeenCalled();
    expect(result).toEqual([{ name: "A", viewCount: 150 }]);
  });
});
