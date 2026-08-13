import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetRatedItems = vi.fn();
const mockGetItemRating = vi.fn();
const mockGetAllTrackPlayCounts = vi.fn();

vi.mock("../../api/plex/ratings", () => ({
  getRatedItems: (...args: unknown[]) => mockGetRatedItems(...args),
  getItemRating: (...args: unknown[]) => mockGetItemRating(...args),
}));
vi.mock("../../api/plex/trackPlayCounts", () => ({
  getAllTrackPlayCounts: (...args: unknown[]) =>
    mockGetAllTrackPlayCounts(...args),
}));

import {
  latestRatings,
  diffRatings,
  detectUnratings,
  playsDue,
  reconstructPlayCounts,
  reconstructTrackPlayCounts,
  rollupToArtists,
  rollupToAlbums,
  ingestUserRatings,
  ingestUserTrackPlays,
  type PlexRatingPayload,
  type PlexTrackPlaysPayload,
  type TrackPlayState,
} from "./signalIngestion";
import { initializeDatabase, closeDatabase, getDataSource } from "../../db";
import { getSignalEvents } from "../../db/userProfile";
import type { UserSignalEvent } from "../../db/entity/UserSignalEvent";

function ratingEvent(
  payload: PlexRatingPayload,
  recordedAt = "2026-01-01T00:00:00.000Z"
): UserSignalEvent {
  return {
    id: 0,
    user_id: 1,
    kind: "plex_rating",
    payload: JSON.stringify(payload),
    recorded_at: recordedAt,
  } as UserSignalEvent;
}

const ratedTrack = {
  ratingKey: "451",
  kind: "track" as const,
  title: "Air",
  artist: "Andromedik",
  rating: 10,
};

const ratedAlbum = {
  ratingKey: "999",
  kind: "album" as const,
  title: "Reflections",
  artist: "Durry",
  rating: 8,
};

describe("latestRatings", () => {
  it("replays the log so a later write wins", () => {
    const map = latestRatings([
      ratingEvent({ ...ratedTrack, rating: 6 }, "2026-01-01T00:00:00.000Z"),
      ratingEvent({ ...ratedTrack, rating: 8 }, "2026-02-01T00:00:00.000Z"),
    ]);
    expect(map.get("451")?.rating).toBe(8);
  });

  it("skips corrupt rows", () => {
    const corrupt = { ...ratingEvent(ratedTrack), payload: "not json" };
    const map = latestRatings([corrupt as UserSignalEvent]);
    expect(map.size).toBe(0);
  });
});

describe("diffRatings", () => {
  it("emits new and changed ratings, skips unchanged", () => {
    const previous = new Map<string, PlexRatingPayload>([
      ["451", { ...ratedTrack, rating: 10 }],
      [
        "999",
        { ratingKey: "999", kind: "album", title: "X", artist: "Y", rating: 4 },
      ],
    ]);
    const current = [
      { ...ratedTrack, rating: 10 }, // unchanged → skip
      {
        ratingKey: "999",
        kind: "album" as const,
        title: "X",
        artist: "Y",
        rating: 6,
      }, // changed
      {
        ratingKey: "1577",
        kind: "track" as const,
        title: "New",
        artist: "Z",
        rating: 8,
      }, // new
    ];
    const changes = diffRatings(previous, current);
    expect(changes.map((c) => c.ratingKey).sort()).toEqual(["1577", "999"]);
    expect(changes.find((c) => c.ratingKey === "999")?.rating).toBe(6);
  });

  it("does not emit a clear for an item dropping out of the rated set", () => {
    const previous = new Map<string, PlexRatingPayload>([
      ["451", { ...ratedTrack, rating: 10 }],
    ]);
    expect(diffRatings(previous, [])).toEqual([]);
  });
});

function playsEvent(
  artists: { name: string; playCount: number }[],
  recordedAt: string
): UserSignalEvent {
  return {
    id: 0,
    user_id: 1,
    kind: "plex_plays",
    payload: JSON.stringify({ artists }),
    recorded_at: recordedAt,
  } as UserSignalEvent;
}

describe("reconstructPlayCounts", () => {
  it("folds deltas last-write-wins and carries unchanged artists forward", () => {
    const events = [
      playsEvent(
        [
          { name: "A", playCount: 10 },
          { name: "B", playCount: 5 },
        ],
        "2026-01-01T00:00:00.000Z"
      ),
      playsEvent([{ name: "A", playCount: 30 }], "2026-02-01T00:00:00.000Z"),
    ];
    const counts = reconstructPlayCounts(events, Infinity);
    expect(counts.get("A")).toBe(30);
    expect(counts.get("B")).toBe(5);
  });

  it("ignores events recorded after the cutoff", () => {
    const events = [
      playsEvent([{ name: "A", playCount: 10 }], "2026-01-01T00:00:00.000Z"),
      playsEvent([{ name: "A", playCount: 30 }], "2026-03-01T00:00:00.000Z"),
    ];
    const counts = reconstructPlayCounts(
      events,
      Date.parse("2026-02-01T00:00:00.000Z")
    );
    expect(counts.get("A")).toBe(10);
  });

  it("skips corrupt rows", () => {
    const events = [
      { ...playsEvent([], "2026-01-01T00:00:00.000Z"), payload: "not json" },
      playsEvent([{ name: "A", playCount: 7 }], "2026-02-01T00:00:00.000Z"),
    ];
    const counts = reconstructPlayCounts(events as UserSignalEvent[], Infinity);
    expect(counts.get("A")).toBe(7);
    expect(counts.size).toBe(1);
  });
});

function liveTrack(ratingKey: string, artistName: string, viewCount: number) {
  return {
    ratingKey,
    title: `t${ratingKey}`,
    artistKey: `ak-${artistName}`,
    artistName,
    albumKey: `alb-${artistName}`,
    albumTitle: "Album",
    viewCount,
  };
}

function trackState(
  ratingKey: string,
  artistName: string,
  playCount: number,
  overrides: Partial<TrackPlayState> = {}
): TrackPlayState {
  return {
    ratingKey,
    title: `t${ratingKey}`,
    artistKey: `ak-${artistName}`,
    artistName,
    albumKey: `alb-${artistName}`,
    albumTitle: "Album",
    playCount,
    ...overrides,
  };
}

function trackPlaysEvent(
  tracks: TrackPlayState[],
  recordedAt: string
): UserSignalEvent {
  return {
    id: 0,
    user_id: 1,
    kind: "plex_track_plays",
    payload: JSON.stringify({ tracks } satisfies PlexTrackPlaysPayload),
    recorded_at: recordedAt,
  } as UserSignalEvent;
}

describe("reconstructTrackPlayCounts", () => {
  it("folds deltas last-write-wins and carries unchanged tracks forward", () => {
    const events = [
      trackPlaysEvent(
        [trackState("1", "A", 10), trackState("2", "A", 5)],
        "2026-01-01T00:00:00.000Z"
      ),
      trackPlaysEvent([trackState("1", "A", 30)], "2026-02-01T00:00:00.000Z"),
    ];
    const tracks = reconstructTrackPlayCounts(events, Infinity);
    expect(tracks.get("1")?.playCount).toBe(30);
    expect(tracks.get("2")?.playCount).toBe(5);
  });

  it("ignores events recorded after the cutoff", () => {
    const events = [
      trackPlaysEvent([trackState("1", "A", 10)], "2026-01-01T00:00:00.000Z"),
      trackPlaysEvent([trackState("1", "A", 30)], "2026-03-01T00:00:00.000Z"),
    ];
    const tracks = reconstructTrackPlayCounts(
      events,
      Date.parse("2026-02-01T00:00:00.000Z")
    );
    expect(tracks.get("1")?.playCount).toBe(10);
  });

  it("skips corrupt rows and rows with no rating key", () => {
    const events = [
      {
        ...trackPlaysEvent([], "2026-01-01T00:00:00.000Z"),
        payload: "not json",
      },
      {
        ...trackPlaysEvent([], "2026-01-02T00:00:00.000Z"),
        payload: JSON.stringify({ tracks: [{ playCount: 3 }] }),
      },
      trackPlaysEvent([trackState("1", "A", 7)], "2026-02-01T00:00:00.000Z"),
    ];
    const tracks = reconstructTrackPlayCounts(
      events as UserSignalEvent[],
      Infinity
    );
    expect(tracks.size).toBe(1);
    expect(tracks.get("1")?.playCount).toBe(7);
  });
});

describe("rollupToArtists", () => {
  it("sums track plays per artist", () => {
    const tracks = reconstructTrackPlayCounts(
      [
        trackPlaysEvent(
          [
            trackState("1", "A", 4),
            trackState("2", "A", 6),
            trackState("3", "B", 2),
          ],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );
    expect(rollupToArtists(tracks)).toEqual([
      {
        artistKey: "ak-A",
        name: "A",
        playCount: 10,
        distinctTracksPlayed: 2,
        topTrackPlayCount: 6,
      },
      {
        artistKey: "ak-B",
        name: "B",
        playCount: 2,
        distinctTracksPlayed: 1,
        topTrackPlayCount: 2,
      },
    ]);
  });

  it("groups by artistKey, keeping a renamed artist as one bucket", () => {
    const tracks = reconstructTrackPlayCounts(
      [
        trackPlaysEvent(
          [
            trackState("1", "Old", 3, { artistKey: "k1" }),
            trackState("2", "New", 5, { artistKey: "k1" }),
          ],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );
    expect(rollupToArtists(tracks)).toEqual([
      {
        artistKey: "k1",
        name: "Old",
        playCount: 8,
        distinctTracksPlayed: 2,
        topTrackPlayCount: 5,
      },
    ]);
  });

  it("falls back to the name when a track carries no artist key", () => {
    const tracks = reconstructTrackPlayCounts(
      [
        trackPlaysEvent(
          [trackState("1", "A", 3, { artistKey: "" })],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );
    expect(rollupToArtists(tracks)).toEqual([
      {
        artistKey: "A",
        name: "A",
        playCount: 3,
        distinctTracksPlayed: 1,
        topTrackPlayCount: 3,
      },
    ]);
  });

  it("drops tracks with neither an artist key nor a name", () => {
    const tracks = reconstructTrackPlayCounts(
      [
        trackPlaysEvent(
          [trackState("1", "", 3, { artistKey: "" })],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );
    expect(rollupToArtists(tracks)).toEqual([]);
  });
});

describe("rollupToArtists with a baseline", () => {
  it("rolls up only the plays gained since the baseline", () => {
    const latest = reconstructTrackPlayCounts(
      [
        trackPlaysEvent(
          [trackState("1", "A", 30), trackState("2", "A", 10)],
          "2026-02-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );
    const baseline = reconstructTrackPlayCounts(
      [
        trackPlaysEvent(
          [trackState("1", "A", 25), trackState("2", "A", 10)],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );

    expect(rollupToArtists(latest, baseline)).toEqual([
      {
        artistKey: "ak-A",
        name: "A",
        playCount: 5,
        distinctTracksPlayed: 1,
        topTrackPlayCount: 5,
      },
    ]);
  });

  it("counts a track absent from the baseline in full", () => {
    const latest = reconstructTrackPlayCounts(
      [trackPlaysEvent([trackState("9", "A", 4)], "2026-02-01T00:00:00.000Z")],
      Infinity
    );

    expect(rollupToArtists(latest, new Map())).toEqual([
      {
        artistKey: "ak-A",
        name: "A",
        playCount: 4,
        distinctTracksPlayed: 1,
        topTrackPlayCount: 4,
      },
    ]);
  });
});

describe("rollupToAlbums", () => {
  it("sums track plays per album", () => {
    const tracks = reconstructTrackPlayCounts(
      [
        trackPlaysEvent(
          [
            trackState("1", "A", 4, { albumKey: "alb1", albumTitle: "One" }),
            trackState("2", "A", 6, { albumKey: "alb1", albumTitle: "One" }),
            trackState("3", "A", 1, { albumKey: "alb2", albumTitle: "Two" }),
          ],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );
    expect(rollupToAlbums(tracks)).toEqual([
      { albumKey: "alb1", title: "One", artistName: "A", playCount: 10 },
      { albumKey: "alb2", title: "Two", artistName: "A", playCount: 1 },
    ]);
  });

  it("drops tracks with no album attribution at all", () => {
    const tracks = reconstructTrackPlayCounts(
      [
        trackPlaysEvent(
          [trackState("1", "A", 4, { albumKey: "", albumTitle: "" })],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );
    expect(rollupToAlbums(tracks)).toEqual([]);
  });
});

describe("detectUnratings", () => {
  it("finds previously-rated keys absent from the current set", () => {
    const previous = new Map<string, PlexRatingPayload>([
      ["451", { ...ratedTrack, rating: 10 }],
      [
        "999",
        { ratingKey: "999", kind: "album", title: "X", artist: "Y", rating: 4 },
      ],
    ]);
    const current = [{ ...ratedTrack, rating: 10 }];
    expect(detectUnratings(previous, current)).toEqual(["999"]);
  });

  it("ignores keys already cleared (rating 0)", () => {
    const previous = new Map<string, PlexRatingPayload>([
      ["451", { ...ratedTrack, rating: 0 }],
    ]);
    expect(detectUnratings(previous, [])).toEqual([]);
  });
});

describe("playsDue", () => {
  const now = Date.parse("2026-06-28T12:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;

  it("is due when no plays capture exists", () => {
    expect(playsDue([], now, day)).toBe(true);
  });

  it("is not due when the last plays capture is within the interval", () => {
    const recent = {
      recorded_at: "2026-06-28T06:00:00.000Z",
    } as UserSignalEvent;
    expect(playsDue([recent], now, day)).toBe(false);
  });

  it("is due when the last plays capture is older than the interval", () => {
    const old = { recorded_at: "2026-06-26T06:00:00.000Z" } as UserSignalEvent;
    expect(playsDue([old], now, day)).toBe(true);
  });
});

describe("ingestion (with DB)", () => {
  beforeEach(async () => {
    await initializeDatabase(":memory:");
    await getDataSource().query("INSERT INTO users (username) VALUES (?)", [
      "alice",
    ]);
  });
  afterEach(async () => {
    await closeDatabase();
  });

  it("writes all ratings on first run, then nothing on an unchanged re-run", async () => {
    mockGetRatedItems.mockResolvedValue([ratedTrack]);

    expect(await ingestUserRatings(1, "tok")).toBe(1);
    expect(await ingestUserRatings(1, "tok")).toBe(0);

    const events = await getSignalEvents(1, "plex_rating");
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].payload).artist).toBe("Andromedik");
  });

  it("appends one event when an existing rating changes", async () => {
    mockGetRatedItems.mockResolvedValueOnce([ratedTrack]);
    await ingestUserRatings(1, "tok");
    mockGetRatedItems.mockResolvedValueOnce([{ ...ratedTrack, rating: 4 }]);

    expect(await ingestUserRatings(1, "tok")).toBe(1);
    const events = await getSignalEvents(1, "plex_rating");
    expect(events).toHaveLength(2);
    expect(JSON.parse(events[1].payload).rating).toBe(4);
  });

  it("writes a track-plays capture covering every played track", async () => {
    mockGetAllTrackPlayCounts.mockResolvedValue([
      liveTrack("1", "Andromedik", 120),
      liveTrack("2", "Durry", 30),
    ]);

    await ingestUserTrackPlays(1, "tok");

    const events = await getSignalEvents(1, "plex_track_plays");
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0].payload) as PlexTrackPlaysPayload;
    expect(payload.tracks).toEqual([
      {
        ratingKey: "1",
        title: "t1",
        artistKey: "ak-Andromedik",
        artistName: "Andromedik",
        albumKey: "alb-Andromedik",
        albumTitle: "Album",
        playCount: 120,
      },
      {
        ratingKey: "2",
        title: "t2",
        artistKey: "ak-Durry",
        artistName: "Durry",
        albumKey: "alb-Durry",
        albumTitle: "Album",
        playCount: 30,
      },
    ]);
    expect(mockGetAllTrackPlayCounts).toHaveBeenCalledWith("tok");
  });

  it("writes a delta of only the tracks whose count increased", async () => {
    mockGetAllTrackPlayCounts.mockReset();
    mockGetAllTrackPlayCounts.mockResolvedValueOnce([
      liveTrack("1", "A", 10),
      liveTrack("2", "B", 5),
    ]);
    await ingestUserTrackPlays(1, "tok");
    mockGetAllTrackPlayCounts.mockResolvedValueOnce([
      liveTrack("1", "A", 30),
      liveTrack("2", "B", 5),
    ]);
    await ingestUserTrackPlays(1, "tok");

    const events = await getSignalEvents(1, "plex_track_plays");
    expect(events).toHaveLength(2);
    const delta = JSON.parse(events[1].payload) as PlexTrackPlaysPayload;
    expect(delta.tracks.map((t) => [t.ratingKey, t.playCount])).toEqual([
      ["1", 30],
    ]);
  });

  it("writes nothing when no count increased", async () => {
    mockGetAllTrackPlayCounts.mockReset();
    mockGetAllTrackPlayCounts.mockResolvedValue([liveTrack("1", "A", 10)]);

    await ingestUserTrackPlays(1, "tok");
    await ingestUserTrackPlays(1, "tok");

    expect(await getSignalEvents(1, "plex_track_plays")).toHaveLength(1);
  });

  it("never records a decrease or a vanished track (monotonic)", async () => {
    mockGetAllTrackPlayCounts.mockReset();
    mockGetAllTrackPlayCounts.mockResolvedValueOnce([
      liveTrack("1", "A", 10),
      liveTrack("2", "B", 5),
    ]);
    await ingestUserTrackPlays(1, "tok");
    mockGetAllTrackPlayCounts.mockResolvedValueOnce([liveTrack("1", "A", 8)]);
    await ingestUserTrackPlays(1, "tok");

    expect(await getSignalEvents(1, "plex_track_plays")).toHaveLength(1);
  });

  it("treats a transient-empty read as a no-op", async () => {
    mockGetAllTrackPlayCounts.mockReset();
    mockGetAllTrackPlayCounts.mockResolvedValueOnce([liveTrack("1", "A", 10)]);
    await ingestUserTrackPlays(1, "tok");
    mockGetAllTrackPlayCounts.mockResolvedValueOnce([]);
    await ingestUserTrackPlays(1, "tok");

    expect(await getSignalEvents(1, "plex_track_plays")).toHaveLength(1);
  });

  it("chunks a large first capture and folds it back identically", async () => {
    mockGetAllTrackPlayCounts.mockReset();
    const live = Array.from({ length: 4500 }, (_, i) =>
      liveTrack(String(i), `A${i % 3}`, i + 1)
    );
    mockGetAllTrackPlayCounts.mockResolvedValueOnce(live);

    await ingestUserTrackPlays(1, "tok");

    const events = await getSignalEvents(1, "plex_track_plays");
    expect(events).toHaveLength(3);
    expect(
      events.map(
        (e) => (JSON.parse(e.payload) as PlexTrackPlaysPayload).tracks.length
      )
    ).toEqual([2000, 2000, 500]);

    const folded = reconstructTrackPlayCounts(events, Infinity);
    expect(folded.size).toBe(4500);
    expect(folded.get("4499")?.playCount).toBe(4500);
  });

  it("re-reads its own chunked capture as unchanged", async () => {
    mockGetAllTrackPlayCounts.mockReset();
    const live = Array.from({ length: 2500 }, (_, i) =>
      liveTrack(String(i), "A", i + 1)
    );
    mockGetAllTrackPlayCounts.mockResolvedValue(live);

    await ingestUserTrackPlays(1, "tok");
    await ingestUserTrackPlays(1, "tok");

    expect(await getSignalEvents(1, "plex_track_plays")).toHaveLength(2);
  });

  it("records a confirmed un-rating as a rating-0 event", async () => {
    mockGetRatedItems.mockReset();
    mockGetItemRating.mockReset();
    mockGetRatedItems.mockResolvedValueOnce([ratedTrack, ratedAlbum]);
    await ingestUserRatings(1, "tok");
    mockGetRatedItems.mockResolvedValueOnce([ratedAlbum]);
    mockGetItemRating.mockResolvedValueOnce(null);

    expect(await ingestUserRatings(1, "tok")).toBe(1);

    const events = await getSignalEvents(1, "plex_rating");
    expect(events).toHaveLength(3);
    const last = JSON.parse(events[2].payload) as PlexRatingPayload;
    expect(last).toMatchObject({ ratingKey: "451", rating: 0 });
    expect(mockGetItemRating).toHaveBeenCalledWith("tok", "451");
  });

  it("does not record an un-rating when Plex still reports a rating", async () => {
    mockGetRatedItems.mockReset();
    mockGetItemRating.mockReset();
    mockGetRatedItems.mockResolvedValueOnce([ratedTrack, ratedAlbum]);
    await ingestUserRatings(1, "tok");
    mockGetRatedItems.mockResolvedValueOnce([ratedAlbum]);
    mockGetItemRating.mockResolvedValueOnce(10);

    expect(await ingestUserRatings(1, "tok")).toBe(0);
    expect(await getSignalEvents(1, "plex_rating")).toHaveLength(2);
  });

  it("skips un-rating detection when an implausible number disappear", async () => {
    mockGetRatedItems.mockReset();
    mockGetItemRating.mockReset();
    const many = Array.from({ length: 52 }, (_, i) => ({
      ratingKey: `k${i}`,
      kind: "track" as const,
      title: `t${i}`,
      artist: "Z",
      rating: 8,
    }));
    mockGetRatedItems.mockResolvedValueOnce(many);
    await ingestUserRatings(1, "tok");
    mockGetRatedItems.mockResolvedValueOnce([many[0]]);

    expect(await ingestUserRatings(1, "tok")).toBe(0);
    expect(await getSignalEvents(1, "plex_rating")).toHaveLength(52);
    expect(mockGetItemRating).not.toHaveBeenCalled();
  });

  it("does not detect un-ratings from an empty response", async () => {
    mockGetRatedItems.mockReset();
    mockGetItemRating.mockReset();
    mockGetRatedItems.mockResolvedValueOnce([ratedTrack]);
    await ingestUserRatings(1, "tok");
    mockGetRatedItems.mockResolvedValueOnce([]);

    expect(await ingestUserRatings(1, "tok")).toBe(0);
    expect(await getSignalEvents(1, "plex_rating")).toHaveLength(1);
    expect(mockGetItemRating).not.toHaveBeenCalled();
  });
});
