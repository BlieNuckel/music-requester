import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetRatedItems = vi.fn();
const mockGetItemRating = vi.fn();
const mockGetAllTrackPlayCounts = vi.fn();
const mockGetAllAlbumTrackCounts = vi.fn();

vi.mock("../../api/plex/ratings", () => ({
  getRatedItems: (...args: unknown[]) => mockGetRatedItems(...args),
  getItemRating: (...args: unknown[]) => mockGetItemRating(...args),
}));
vi.mock("../../api/plex/trackPlayCounts", () => ({
  getAllTrackPlayCounts: (...args: unknown[]) =>
    mockGetAllTrackPlayCounts(...args),
}));
vi.mock("../../api/plex/albumTrackCounts", () => ({
  getAllAlbumTrackCounts: (...args: unknown[]) =>
    mockGetAllAlbumTrackCounts(...args),
}));

import {
  latestRatings,
  diffRatings,
  detectUnratings,
  captureDue,
  reconstructTrackPlayCounts,
  rollupToArtists,
  rollupToAlbums,
  reconstructAlbumTrackCounts,
  rollupToArtistCatalogue,
  ingestUserRatings,
  ingestUserTrackPlays,
  ingestUserAlbumTracks,
  type PlexRatingPayload,
  type PlexAlbumTracksPayload,
  type PlexTrackPlaysPayload,
  type TrackPlayState,
  type AlbumTrackState,
  NOMINAL_TRACK_MS,
} from "./signalIngestion";
import { initializeDatabase, closeDatabase, getDataSource } from "../../db";
import { appendSignalEvents, getSignalEvents } from "../../db/userProfile";
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

  it("rewrites an unchanged rating stored without the parent keys", () => {
    const previous = new Map<string, PlexRatingPayload>([
      ["451", { ...ratedTrack }],
    ]);
    const changes = diffRatings(previous, [
      { ...ratedTrack, albumKey: "88", artistKey: "7" },
    ]);
    expect(changes).toEqual([
      { ...ratedTrack, albumKey: "88", artistKey: "7" },
    ]);
  });

  it("leaves a rating that already carries the parent keys alone", () => {
    const stored = { ...ratedTrack, albumKey: "88", artistKey: "7" };
    const previous = new Map<string, PlexRatingPayload>([["451", stored]]);
    expect(diffRatings(previous, [stored])).toEqual([]);
  });
});

function liveTrack(
  ratingKey: string,
  artistName: string,
  viewCount: number,
  durationMs = 0
) {
  return {
    ratingKey,
    title: `t${ratingKey}`,
    artistKey: `ak-${artistName}`,
    artistName,
    albumKey: `alb-${artistName}`,
    albumTitle: "Album",
    viewCount,
    durationMs,
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
        listenedMs: 10 * NOMINAL_TRACK_MS,
        distinctTracksPlayed: 2,
        topTrackPlayCount: 6,
        topTrackListenedMs: 6 * NOMINAL_TRACK_MS,
        topTrackKey: "2",
      },
      {
        artistKey: "ak-B",
        name: "B",
        playCount: 2,
        listenedMs: 2 * NOMINAL_TRACK_MS,
        distinctTracksPlayed: 1,
        topTrackPlayCount: 2,
        topTrackListenedMs: 2 * NOMINAL_TRACK_MS,
        topTrackKey: "3",
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
        listenedMs: 8 * NOMINAL_TRACK_MS,
        distinctTracksPlayed: 2,
        topTrackPlayCount: 5,
        topTrackListenedMs: 5 * NOMINAL_TRACK_MS,
        topTrackKey: "2",
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
        listenedMs: 3 * NOMINAL_TRACK_MS,
        distinctTracksPlayed: 1,
        topTrackPlayCount: 3,
        topTrackListenedMs: 3 * NOMINAL_TRACK_MS,
        topTrackKey: "1",
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

describe("rollupToArtists listening time", () => {
  it("infers listening time from play count and track length", () => {
    const tracks = reconstructTrackPlayCounts(
      [
        trackPlaysEvent(
          [
            trackState("1", "A", 2, { durationMs: 5_400_000 }),
            trackState("2", "A", 10, { durationMs: 180_000 }),
          ],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );

    const [artist] = rollupToArtists(tracks);
    expect(artist.playCount).toBe(12);
    expect(artist.listenedMs).toBe(2 * 5_400_000 + 10 * 180_000);
  });

  it("folds a track with no stored duration to the nominal length", () => {
    const tracks = reconstructTrackPlayCounts(
      [trackPlaysEvent([trackState("1", "A", 4)], "2026-01-01T00:00:00.000Z")],
      Infinity
    );

    expect(rollupToArtists(tracks)[0].listenedMs).toBe(4 * NOMINAL_TRACK_MS);
  });

  it("takes the most-listened track for the listening share, plays for the top track", () => {
    const tracks = reconstructTrackPlayCounts(
      [
        trackPlaysEvent(
          [
            trackState("dj-set", "A", 1, { durationMs: 5_400_000 }),
            trackState("single", "A", 8, { durationMs: 180_000 }),
          ],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );

    const [artist] = rollupToArtists(tracks);
    expect(artist.topTrackKey).toBe("single");
    expect(artist.topTrackPlayCount).toBe(8);
    expect(artist.topTrackListenedMs).toBe(5_400_000);
  });

  it("keeps listening time proportional to plays when no track has a duration", () => {
    const tracks = reconstructTrackPlayCounts(
      [
        trackPlaysEvent(
          [trackState("1", "A", 6), trackState("2", "B", 2)],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );

    const [a, b] = rollupToArtists(tracks);
    expect(a.listenedMs / b.listenedMs).toBe(a.playCount / b.playCount);
  });

  it("infers listening time from the windowed delta, not the all-time count", () => {
    const latest = reconstructTrackPlayCounts(
      [
        trackPlaysEvent(
          [trackState("1", "A", 30, { durationMs: 600_000 })],
          "2026-02-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );
    const baseline = reconstructTrackPlayCounts(
      [
        trackPlaysEvent(
          [trackState("1", "A", 28, { durationMs: 600_000 })],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );

    expect(rollupToArtists(latest, baseline)[0].listenedMs).toBe(2 * 600_000);
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
        listenedMs: 5 * NOMINAL_TRACK_MS,
        distinctTracksPlayed: 1,
        topTrackPlayCount: 5,
        topTrackListenedMs: 5 * NOMINAL_TRACK_MS,
        topTrackKey: "1",
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
        listenedMs: 4 * NOMINAL_TRACK_MS,
        distinctTracksPlayed: 1,
        topTrackPlayCount: 4,
        topTrackListenedMs: 4 * NOMINAL_TRACK_MS,
        topTrackKey: "9",
      },
    ]);
  });
});

function albumState(
  ratingKey: string,
  artistName: string,
  trackCount: number,
  overrides: Partial<AlbumTrackState> = {}
): AlbumTrackState {
  return {
    ratingKey,
    title: `alb${ratingKey}`,
    artistKey: `ak-${artistName}`,
    artistName,
    trackCount,
    ...overrides,
  };
}

function albumTracksEvent(
  albums: AlbumTrackState[],
  recordedAt: string
): UserSignalEvent {
  return {
    id: 0,
    user_id: 1,
    kind: "plex_album_tracks",
    payload: JSON.stringify({ albums } satisfies PlexAlbumTracksPayload),
    recorded_at: recordedAt,
  } as UserSignalEvent;
}

describe("reconstructAlbumTrackCounts", () => {
  it("folds deltas last-write-wins and carries unchanged albums forward", () => {
    const albums = reconstructAlbumTrackCounts(
      [
        albumTracksEvent(
          [albumState("1", "A", 10), albumState("2", "A", 5)],
          "2026-01-01T00:00:00.000Z"
        ),
        albumTracksEvent(
          [albumState("1", "A", 12)],
          "2026-02-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );
    expect(albums.get("1")?.trackCount).toBe(12);
    expect(albums.get("2")?.trackCount).toBe(5);
  });

  it("ignores events recorded after the cutoff", () => {
    const albums = reconstructAlbumTrackCounts(
      [
        albumTracksEvent(
          [albumState("1", "A", 10)],
          "2026-01-01T00:00:00.000Z"
        ),
        albumTracksEvent(
          [albumState("1", "A", 12)],
          "2026-03-01T00:00:00.000Z"
        ),
      ],
      Date.parse("2026-02-01T00:00:00.000Z")
    );
    expect(albums.get("1")?.trackCount).toBe(10);
  });
});

describe("rollupToArtistCatalogue", () => {
  it("sums an artist's albums into one track count", () => {
    const albums = reconstructAlbumTrackCounts(
      [
        albumTracksEvent(
          [
            albumState("1", "A", 10),
            albumState("2", "A", 4),
            albumState("3", "B", 1),
          ],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );
    const catalogue = rollupToArtistCatalogue(albums);
    expect(catalogue.get("A")).toBe(14);
    expect(catalogue.get("B")).toBe(1);
  });

  it("groups by artistKey, keeping a renamed artist as one bucket", () => {
    const albums = reconstructAlbumTrackCounts(
      [
        albumTracksEvent(
          [
            albumState("1", "Old", 6, { artistKey: "k1" }),
            albumState("2", "New", 4, { artistKey: "k1" }),
          ],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );
    expect(rollupToArtistCatalogue(albums).get("Old")).toBe(10);
  });

  it("keeps the larger catalogue when two artists share a name", () => {
    const albums = reconstructAlbumTrackCounts(
      [
        albumTracksEvent(
          [
            albumState("1", "Nova", 3, { artistKey: "k1" }),
            albumState("2", "Nova", 9, { artistKey: "k2" }),
          ],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );
    expect(rollupToArtistCatalogue(albums).get("Nova")).toBe(9);
  });

  it("drops albums with no artist attribution at all", () => {
    const albums = reconstructAlbumTrackCounts(
      [
        albumTracksEvent(
          [albumState("1", "", 5, { artistKey: "" })],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );
    expect(rollupToArtistCatalogue(albums).size).toBe(0);
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
      {
        albumKey: "alb1",
        title: "One",
        artistKey: "ak-A",
        artistName: "A",
        playCount: 10,
        listenedMs: 10 * NOMINAL_TRACK_MS,
      },
      {
        albumKey: "alb2",
        title: "Two",
        artistKey: "ak-A",
        artistName: "A",
        playCount: 1,
        listenedMs: NOMINAL_TRACK_MS,
      },
    ]);
  });

  it("sums each track's own length into the album's listening time", () => {
    const tracks = reconstructTrackPlayCounts(
      [
        trackPlaysEvent(
          [
            trackState("1", "A", 2, {
              albumKey: "alb1",
              albumTitle: "One",
              durationMs: 300_000,
            }),
            trackState("2", "A", 1, {
              albumKey: "alb1",
              albumTitle: "One",
              durationMs: 600_000,
            }),
          ],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );

    expect(rollupToAlbums(tracks)[0].listenedMs).toBe(1_200_000);
  });

  it("caps what one play of a long track contributes, as the artist rollup does", () => {
    const tracks = reconstructTrackPlayCounts(
      [
        trackPlaysEvent(
          [
            trackState("1", "A", 2, {
              albumKey: "alb1",
              albumTitle: "One",
              durationMs: 3_600_000,
            }),
          ],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );

    expect(rollupToAlbums(tracks, 600_000)[0].listenedMs).toBe(1_200_000);
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

describe("captureDue", () => {
  const now = Date.parse("2026-06-28T12:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;

  it("is due when no plays capture exists", () => {
    expect(captureDue([], now, day)).toBe(true);
  });

  it("is not due when the last plays capture is within the interval", () => {
    const recent = {
      recorded_at: "2026-06-28T06:00:00.000Z",
    } as UserSignalEvent;
    expect(captureDue([recent], now, day)).toBe(false);
  });

  it("is due when the last plays capture is older than the interval", () => {
    const old = { recorded_at: "2026-06-26T06:00:00.000Z" } as UserSignalEvent;
    expect(captureDue([old], now, day)).toBe(true);
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
      liveTrack("1", "Andromedik", 120, 240_000),
      liveTrack("2", "Durry", 30, 180_000),
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
        durationMs: 240_000,
      },
      {
        ratingKey: "2",
        title: "t2",
        artistKey: "ak-Durry",
        artistName: "Durry",
        albumKey: "alb-Durry",
        albumTitle: "Album",
        playCount: 30,
        durationMs: 180_000,
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

  it("writes a catalogue capture, then nothing when nothing changed", async () => {
    mockGetAllAlbumTrackCounts.mockResolvedValue([
      {
        ratingKey: "alb1",
        title: "Prologue",
        artistKey: "art1",
        artistName: "Andromedik",
        trackCount: 11,
        genres: [],
      },
    ]);

    await ingestUserAlbumTracks(1, "tok");
    await ingestUserAlbumTracks(1, "tok");

    const events = await getSignalEvents(1, "plex_album_tracks");
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0].payload) as PlexAlbumTracksPayload;
    expect(payload.albums[0].trackCount).toBe(11);
  });

  it("re-emits an album whose genres changed even though its track count did not", async () => {
    const album = {
      ratingKey: "alb1",
      title: "Prologue",
      artistKey: "art1",
      artistName: "Andromedik",
      trackCount: 11,
      genres: ["Drum & Bass"],
    };
    mockGetAllAlbumTrackCounts.mockResolvedValueOnce([album]);
    await ingestUserAlbumTracks(1, "tok");
    mockGetAllAlbumTrackCounts.mockResolvedValueOnce([
      { ...album, genres: ["Drum & Bass", "Electronic"] },
    ]);
    await ingestUserAlbumTracks(1, "tok");

    const events = await getSignalEvents(1, "plex_album_tracks");
    expect(events).toHaveLength(2);
    const latest = JSON.parse(events[1].payload) as PlexAlbumTracksPayload;
    expect(latest.albums[0].genres).toEqual(["Drum & Bass", "Electronic"]);
  });

  it("backfills genres onto an album stored before the field existed", async () => {
    await appendSignalEvents(1, "plex_album_tracks", [
      {
        albums: [
          {
            ratingKey: "alb1",
            title: "Prologue",
            artistKey: "art1",
            artistName: "Andromedik",
            trackCount: 11,
          },
        ],
      },
    ]);

    mockGetAllAlbumTrackCounts.mockResolvedValueOnce([
      {
        ratingKey: "alb1",
        title: "Prologue",
        artistKey: "art1",
        artistName: "Andromedik",
        trackCount: 11,
        genres: ["Drum & Bass"],
      },
    ]);
    await ingestUserAlbumTracks(1, "tok");

    const events = await getSignalEvents(1, "plex_album_tracks");
    expect(events).toHaveLength(2);
  });

  it("writes nothing for an album Plex has never tagged", async () => {
    const album = {
      ratingKey: "alb1",
      title: "Prologue",
      artistKey: "art1",
      artistName: "Andromedik",
      trackCount: 11,
      genres: [],
    };
    mockGetAllAlbumTrackCounts.mockResolvedValue([album]);

    await ingestUserAlbumTracks(1, "tok");
    await ingestUserAlbumTracks(1, "tok");
    await ingestUserAlbumTracks(1, "tok");

    expect(await getSignalEvents(1, "plex_album_tracks")).toHaveLength(1);
  });

  it("records a track count that went down as well as up", async () => {
    const album = {
      ratingKey: "alb1",
      title: "Prologue",
      artistKey: "art1",
      artistName: "Andromedik",
      trackCount: 11,
      genres: [],
    };
    mockGetAllAlbumTrackCounts.mockResolvedValueOnce([album]);
    await ingestUserAlbumTracks(1, "tok");
    mockGetAllAlbumTrackCounts.mockResolvedValueOnce([
      { ...album, trackCount: 9 },
    ]);

    await ingestUserAlbumTracks(1, "tok");

    const events = await getSignalEvents(1, "plex_album_tracks");
    expect(events).toHaveLength(2);
    const payload = JSON.parse(events[1].payload) as PlexAlbumTracksPayload;
    expect(payload.albums[0].trackCount).toBe(9);
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

  it("re-emits stored tracks that predate durationMs, backfilling the series", async () => {
    mockGetAllTrackPlayCounts.mockReset();
    mockGetAllTrackPlayCounts.mockResolvedValueOnce([liveTrack("1", "A", 10)]);
    await ingestUserTrackPlays(1, "tok");
    mockGetAllTrackPlayCounts.mockResolvedValueOnce([
      liveTrack("1", "A", 10, 600_000),
    ]);
    await ingestUserTrackPlays(1, "tok");

    const events = await getSignalEvents(1, "plex_track_plays");
    expect(events).toHaveLength(2);
    expect(reconstructTrackPlayCounts(events, Infinity).get("1")).toMatchObject(
      { playCount: 10, durationMs: 600_000 }
    );
  });

  it("stops re-emitting once a duration is stored", async () => {
    mockGetAllTrackPlayCounts.mockReset();
    mockGetAllTrackPlayCounts.mockResolvedValueOnce([liveTrack("1", "A", 10)]);
    await ingestUserTrackPlays(1, "tok");
    mockGetAllTrackPlayCounts.mockResolvedValue([
      liveTrack("1", "A", 10, 600_000),
    ]);
    await ingestUserTrackPlays(1, "tok");
    await ingestUserTrackPlays(1, "tok");

    expect(await getSignalEvents(1, "plex_track_plays")).toHaveLength(2);
  });

  it("never re-emits a track Plex reports no duration for", async () => {
    mockGetAllTrackPlayCounts.mockReset();
    mockGetAllTrackPlayCounts.mockResolvedValue([liveTrack("1", "A", 10)]);

    await ingestUserTrackPlays(1, "tok");
    await ingestUserTrackPlays(1, "tok");
    await ingestUserTrackPlays(1, "tok");

    expect(await getSignalEvents(1, "plex_track_plays")).toHaveLength(1);
  });

  it("keeps the stored count when a backfill row reads a lower live count", async () => {
    mockGetAllTrackPlayCounts.mockReset();
    mockGetAllTrackPlayCounts.mockResolvedValueOnce([liveTrack("1", "A", 10)]);
    await ingestUserTrackPlays(1, "tok");
    mockGetAllTrackPlayCounts.mockResolvedValueOnce([
      liveTrack("1", "A", 2, 600_000),
    ]);
    await ingestUserTrackPlays(1, "tok");

    const events = await getSignalEvents(1, "plex_track_plays");
    expect(reconstructTrackPlayCounts(events, Infinity).get("1")).toMatchObject(
      { playCount: 10, durationMs: 600_000 }
    );
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

  it("writes a batch of rating changes in order, newest state last", async () => {
    mockGetRatedItems.mockReset();
    const items = Array.from({ length: 30 }, (_, i) => ({
      ...ratedTrack,
      ratingKey: String(i),
      title: `t${i}`,
      rating: 5,
    }));
    mockGetRatedItems.mockResolvedValueOnce(items);
    expect(await ingestUserRatings(1, "tok")).toBe(30);

    mockGetRatedItems.mockResolvedValueOnce(
      items.map((item) => ({ ...item, rating: 8 }))
    );
    expect(await ingestUserRatings(1, "tok")).toBe(30);

    const events = await getSignalEvents(1, "plex_rating");
    expect(events).toHaveLength(60);

    // The fold must land on the second batch, which shares a recorded_at with the first.
    const folded = latestRatings(events);
    expect(folded.size).toBe(30);
    expect([...folded.values()].every((r) => r.rating === 8)).toBe(true);
  });

  it("records only the un-ratings Plex confirms when several are checked at once", async () => {
    mockGetRatedItems.mockReset();
    mockGetItemRating.mockReset();
    const items = Array.from({ length: 12 }, (_, i) => ({
      ...ratedTrack,
      ratingKey: String(i),
      title: `t${i}`,
    }));
    mockGetRatedItems.mockResolvedValueOnce(items);
    await ingestUserRatings(1, "tok");

    // Everything disappears; Plex confirms half of them as genuinely un-starred.
    mockGetRatedItems.mockResolvedValueOnce([items[0]]);
    mockGetItemRating.mockImplementation((_token: string, key: string) =>
      Promise.resolve(Number(key) % 2 === 0 ? 0 : 7)
    );

    expect(await ingestUserRatings(1, "tok")).toBe(5);
    expect(mockGetItemRating).toHaveBeenCalledTimes(11);

    const cleared = [...latestRatings(await getSignalEvents(1, "plex_rating"))]
      .filter(([, payload]) => payload.rating === 0)
      .map(([key]) => key)
      .sort((a, b) => Number(a) - Number(b));
    expect(cleared).toEqual(["2", "4", "6", "8", "10"]);
  });

  it("skips a candidate whose confirmation read throws", async () => {
    mockGetRatedItems.mockReset();
    mockGetItemRating.mockReset();
    const items = [
      { ...ratedTrack, ratingKey: "1", title: "t1" },
      { ...ratedTrack, ratingKey: "2", title: "t2" },
      { ...ratedTrack, ratingKey: "3", title: "t3" },
    ];
    mockGetRatedItems.mockResolvedValueOnce(items);
    await ingestUserRatings(1, "tok");

    // "3" stays rated so the sweep isn't skipped as a transient-empty read.
    mockGetRatedItems.mockResolvedValueOnce([items[2]]);
    mockGetItemRating.mockImplementation((_token: string, key: string) =>
      key === "1" ? Promise.reject(new Error("plex down")) : Promise.resolve(0)
    );

    expect(await ingestUserRatings(1, "tok")).toBe(1);
    const folded = latestRatings(await getSignalEvents(1, "plex_rating"));
    expect(folded.get("1")?.rating).toBe(10);
    expect(folded.get("2")?.rating).toBe(0);
  });
});

describe("fold parse failures", () => {
  it("skips an unparsable payload mid-series and keeps folding the rest", () => {
    const corrupt = {
      ...ratingEvent(ratedTrack, "2026-01-02T00:00:00.000Z"),
      payload: "{bad",
    } as UserSignalEvent;

    const folded = latestRatings([
      ratingEvent(
        { ...ratedTrack, ratingKey: "1" },
        "2026-01-01T00:00:00.000Z"
      ),
      corrupt,
      ratingEvent(
        { ...ratedTrack, ratingKey: "3" },
        "2026-01-03T00:00:00.000Z"
      ),
    ]);

    expect([...folded.keys()].sort()).toEqual(["1", "3"]);
  });
});
