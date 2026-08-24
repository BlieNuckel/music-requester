import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetPlayHistory = vi.fn();

vi.mock("../../api/plex/playHistory", () => ({
  getPlayHistory: (...args: unknown[]) => mockGetPlayHistory(...args),
}));

import {
  episodeKey,
  historyCoverageStart,
  historyCovers,
  historyWatermark,
  ingestUserListenHistory,
  reconstructListenEpisodes,
  rollupEpisodesToAlbums,
  rollupEpisodesToArtists,
  type ListenEpisode,
  type PlexListenHistoryPayload,
} from "./listenHistory";
import { NOMINAL_TRACK_MS } from "./signalIngestion";
import { initializeDatabase, closeDatabase, getDataSource } from "../../db";
import { appendSignalEvent, getSignalEvents } from "../../db/userProfile";
import type { UserSignalEvent } from "../../db/entity/UserSignalEvent";

const HOUR_MS = 60 * 60 * 1000;

function episode(
  ratingKey: string,
  artistName: string,
  viewedAt: number,
  overrides: Partial<ListenEpisode> = {}
): ListenEpisode {
  const durationMs = overrides.durationMs ?? NOMINAL_TRACK_MS;
  return {
    ratingKey,
    title: `t${ratingKey}`,
    artistKey: `ak-${artistName}`,
    artistName,
    albumKey: `alb-${artistName}`,
    albumTitle: "Album",
    viewedAt,
    startedAt: viewedAt * 1000 - durationMs / 2,
    durationMs,
    listenedMs: durationMs,
    measured: false,
    ...overrides,
  };
}

function episodeEvent(
  episodes: ListenEpisode[],
  recordedAt: string
): UserSignalEvent {
  return {
    payload: JSON.stringify({ episodes } satisfies PlexListenHistoryPayload),
    recorded_at: recordedAt,
  } as UserSignalEvent;
}

function historyRow(
  ratingKey: string,
  artistName: string,
  viewedAt: number,
  overrides: Record<string, unknown> = {}
) {
  return {
    ratingKey,
    title: `t${ratingKey}`,
    artistKey: `ak-${artistName}`,
    artistName,
    albumKey: `alb-${artistName}`,
    albumTitle: "Album",
    viewedAt,
    ...overrides,
  };
}

function episodesOf(events: UserSignalEvent[]): ListenEpisode[] {
  return events.flatMap(
    (event) => (JSON.parse(event.payload) as PlexListenHistoryPayload).episodes
  );
}

describe("reconstructListenEpisodes", () => {
  it("keys episodes on the track and the moment the play committed", () => {
    const episodes = reconstructListenEpisodes(
      [
        episodeEvent(
          [episode("1", "A", 1_770_000_000), episode("1", "A", 1_770_003_600)],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );

    expect(episodes.size).toBe(2);
    expect(episodes.has(episodeKey("1", 1_770_000_000))).toBe(true);
  });

  it("collapses a play reported twice into one episode", () => {
    const episodes = reconstructListenEpisodes(
      [
        episodeEvent(
          [episode("1", "A", 1_770_000_000)],
          "2026-01-01T00:00:00.000Z"
        ),
        episodeEvent(
          [episode("1", "A", 1_770_000_000)],
          "2026-01-02T00:00:00.000Z"
        ),
      ],
      Infinity
    );

    expect(episodes.size).toBe(1);
  });

  it("ignores events recorded after the cutoff", () => {
    const episodes = reconstructListenEpisodes(
      [
        episodeEvent(
          [episode("1", "A", 1_770_000_000)],
          "2026-01-01T00:00:00.000Z"
        ),
        episodeEvent(
          [episode("2", "A", 1_770_003_600)],
          "2026-02-01T00:00:00.000Z"
        ),
      ],
      Date.parse("2026-01-15T00:00:00.000Z")
    );

    expect(episodes.size).toBe(1);
  });

  it("skips malformed episodes rather than failing the fold", () => {
    const episodes = reconstructListenEpisodes(
      [
        episodeEvent(
          [
            episode("1", "A", 1_770_000_000),
            { ratingKey: 7 } as unknown as ListenEpisode,
          ],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );

    expect(episodes.size).toBe(1);
  });
});

describe("historyWatermark", () => {
  it("is zero with nothing stored, so the first sweep reads the whole log", () => {
    expect(historyWatermark(new Map())).toBe(0);
  });

  it("re-reads the newest stored second rather than the one after it", () => {
    const stored = reconstructListenEpisodes(
      [
        episodeEvent(
          [episode("1", "A", 1_770_000_000), episode("2", "A", 1_770_003_600)],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );

    expect(historyWatermark(stored)).toBe(1_770_003_600);
  });
});

describe("historyCoverageStart", () => {
  it("is the oldest listening history covers", () => {
    const stored = reconstructListenEpisodes(
      [
        episodeEvent(
          [episode("1", "A", 1_770_003_600), episode("2", "A", 1_770_000_000)],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );

    expect(historyCoverageStart(stored)).toBe(
      1_770_000_000 * 1000 - NOMINAL_TRACK_MS / 2
    );
  });

  it("is null when history covers nothing", () => {
    expect(historyCoverageStart(new Map())).toBeNull();
  });
});

describe("historyCovers", () => {
  const stored = reconstructListenEpisodes(
    [
      episodeEvent(
        [episode("1", "A", 1_770_000_000)],
        "2026-01-01T00:00:00.000Z"
      ),
    ],
    Infinity
  );
  const coveredFrom = 1_770_000_000 * 1000;

  it("covers a window that starts after the oldest episode", () => {
    expect(historyCovers(stored, coveredFrom + HOUR_MS)).toBe(true);
  });

  it("does not cover a window reaching back past the log", () => {
    expect(historyCovers(stored, coveredFrom - HOUR_MS)).toBe(false);
  });

  it("covers nothing when no episodes are stored", () => {
    expect(historyCovers(new Map(), 0)).toBe(false);
  });
});

describe("rollupEpisodesToAlbums", () => {
  it("sums listening per album and counts the plays behind it", () => {
    const stored = reconstructListenEpisodes(
      [
        episodeEvent(
          [
            episode("1", "A", 1_770_000_000, {
              albumKey: "alb1",
              albumTitle: "One",
              durationMs: 300_000,
            }),
            episode("2", "A", 1_770_010_000, {
              albumKey: "alb1",
              albumTitle: "One",
              durationMs: 180_000,
            }),
            episode("3", "A", 1_770_020_000, {
              albumKey: "alb2",
              albumTitle: "Two",
              durationMs: 180_000,
            }),
          ],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );

    const [one, two] = rollupEpisodesToAlbums(stored);
    expect(one).toMatchObject({
      albumKey: "alb1",
      title: "One",
      artistName: "A",
      playCount: 2,
      listenedMs: 480_000,
    });
    expect(two).toMatchObject({ albumKey: "alb2", playCount: 1 });
  });

  it("counts an episode against the window it started in, not the one it committed in", () => {
    const stored = reconstructListenEpisodes(
      [
        episodeEvent(
          [
            episode("set", "A", 1_770_000_000, {
              albumKey: "alb1",
              albumTitle: "One",
              durationMs: 5_400_000,
            }),
          ],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );
    const startedAt = 1_770_000_000 * 1000 - 5_400_000 / 2;

    expect(rollupEpisodesToAlbums(stored, startedAt + 1)).toEqual([]);
    expect(rollupEpisodesToAlbums(stored, startedAt)).toHaveLength(1);
  });

  it("caps what one episode contributes when a ceiling is given", () => {
    const stored = reconstructListenEpisodes(
      [
        episodeEvent(
          [
            episode("set", "A", 1_770_000_000, {
              albumKey: "alb1",
              albumTitle: "One",
              durationMs: 5_400_000,
            }),
          ],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );

    expect(
      rollupEpisodesToAlbums(stored, -Infinity, Infinity, 600_000)[0].listenedMs
    ).toBe(600_000);
  });

  it("drops an episode with no album attribution at all", () => {
    const stored = reconstructListenEpisodes(
      [
        episodeEvent(
          [
            episode("1", "A", 1_770_000_000, {
              albumKey: "",
              albumTitle: "",
            }),
          ],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );

    expect(rollupEpisodesToAlbums(stored)).toEqual([]);
  });
});

describe("rollupEpisodesToArtists", () => {
  it("sums listening per artist and counts the plays behind it", () => {
    const stored = reconstructListenEpisodes(
      [
        episodeEvent(
          [
            episode("set", "A", 1_770_000_000, { durationMs: 5_400_000 }),
            episode("song", "A", 1_770_010_000, { durationMs: 180_000 }),
            episode("other", "B", 1_770_020_000, { durationMs: 180_000 }),
          ],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );

    const [a, b] = rollupEpisodesToArtists(stored);
    expect(a).toMatchObject({ name: "A", plays: 2, listenedMs: 5_580_000 });
    expect(b).toMatchObject({ name: "B", plays: 1, listenedMs: 180_000 });
  });

  it("takes the track with the most listening across its own episodes", () => {
    const stored = reconstructListenEpisodes(
      [
        episodeEvent(
          [
            episode("set", "A", 1_770_000_000, { durationMs: 3_000_000 }),
            episode("song", "A", 1_770_010_000, { durationMs: 1_800_000 }),
            episode("song", "A", 1_770_020_000, { durationMs: 1_800_000 }),
          ],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );

    expect(rollupEpisodesToArtists(stored)[0]).toMatchObject({
      topTrackKey: "song",
      topTrackListenedMs: 3_600_000,
    });
  });

  it("windows on when playback started, not when the play committed", () => {
    const setStart = 1_770_000_000_000;
    const durationMs = 5_400_000;
    const stored = reconstructListenEpisodes(
      [
        episodeEvent(
          [
            episode("set", "A", (setStart + durationMs / 2) / 1000, {
              durationMs,
            }),
          ],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );

    expect(rollupEpisodesToArtists(stored, setStart - HOUR_MS)).toHaveLength(1);
    expect(rollupEpisodesToArtists(stored, setStart + HOUR_MS)).toHaveLength(0);
  });

  it("groups by artist key so a rename stays one bucket", () => {
    const stored = reconstructListenEpisodes(
      [
        episodeEvent(
          [
            episode("1", "Old", 1_770_000_000, { artistKey: "k1" }),
            episode("2", "New", 1_770_010_000, { artistKey: "k1" }),
          ],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );

    const rollups = rollupEpisodesToArtists(stored);
    expect(rollups).toHaveLength(1);
    expect(rollups[0]).toMatchObject({ artistKey: "k1", plays: 2 });
  });

  it("drops episodes with neither an artist key nor a name", () => {
    const stored = reconstructListenEpisodes(
      [
        episodeEvent(
          [episode("1", "", 1_770_000_000, { artistKey: "" })],
          "2026-01-01T00:00:00.000Z"
        ),
      ],
      Infinity
    );

    expect(rollupEpisodesToArtists(stored)).toEqual([]);
  });
});

describe("ingestUserListenHistory (with DB)", () => {
  beforeEach(async () => {
    await initializeDatabase(":memory:");
    await getDataSource().query("INSERT INTO users (username) VALUES (?)", [
      "alice",
    ]);
    mockGetPlayHistory.mockReset();
  });
  afterEach(async () => {
    await closeDatabase();
  });

  it("backfills the whole log on the first run", async () => {
    mockGetPlayHistory.mockResolvedValue([
      historyRow("1", "A", 1_770_000_000),
      historyRow("2", "A", 1_770_003_600),
    ]);

    expect(await ingestUserListenHistory(1, "tok")).toBe(2);
    expect(mockGetPlayHistory).toHaveBeenCalledWith("tok", 0);
    expect(
      episodesOf(await getSignalEvents(1, "plex_listen_history"))
    ).toHaveLength(2);
  });

  it("reads from the stored watermark on the next run", async () => {
    mockGetPlayHistory.mockResolvedValueOnce([
      historyRow("1", "A", 1_770_000_000),
    ]);
    await ingestUserListenHistory(1, "tok");
    mockGetPlayHistory.mockResolvedValueOnce([]);

    await ingestUserListenHistory(1, "tok");

    expect(mockGetPlayHistory).toHaveBeenLastCalledWith("tok", 1_770_000_000);
  });

  it("appends nothing when the sweep only returns plays it already holds", async () => {
    mockGetPlayHistory.mockResolvedValue([historyRow("1", "A", 1_770_000_000)]);

    await ingestUserListenHistory(1, "tok");
    expect(await ingestUserListenHistory(1, "tok")).toBe(0);
    expect(await getSignalEvents(1, "plex_listen_history")).toHaveLength(1);
  });

  it("collapses a play Plex reports twice in one sweep", async () => {
    mockGetPlayHistory.mockResolvedValue([
      historyRow("1", "A", 1_770_000_000),
      historyRow("1", "A", 1_770_000_000),
    ]);

    expect(await ingestUserListenHistory(1, "tok")).toBe(1);
  });

  it("joins the track length from the play-count series", async () => {
    await appendSignalEvent(1, "plex_track_plays", {
      tracks: [
        {
          ratingKey: "1",
          title: "t1",
          artistKey: "ak-A",
          artistName: "A",
          albumKey: "alb-A",
          albumTitle: "Album",
          playCount: 3,
          durationMs: 5_400_000,
        },
      ],
    });
    mockGetPlayHistory.mockResolvedValue([historyRow("1", "A", 1_770_000_000)]);

    await ingestUserListenHistory(1, "tok");

    const [stored] = episodesOf(
      await getSignalEvents(1, "plex_listen_history")
    );
    expect(stored.durationMs).toBe(5_400_000);
    expect(stored.listenedMs).toBe(5_400_000);
    expect(stored.measured).toBe(false);
  });

  it("corrects the start time for the halfway commit", async () => {
    await appendSignalEvent(1, "plex_track_plays", {
      tracks: [
        {
          ratingKey: "1",
          title: "t1",
          artistKey: "ak-A",
          artistName: "A",
          albumKey: "alb-A",
          albumTitle: "Album",
          playCount: 1,
          durationMs: 5_400_000,
        },
      ],
    });
    mockGetPlayHistory.mockResolvedValue([historyRow("1", "A", 1_770_000_000)]);

    await ingestUserListenHistory(1, "tok");

    const [stored] = episodesOf(
      await getSignalEvents(1, "plex_listen_history")
    );
    expect(stored.startedAt).toBe(1_770_000_000_000 - 2_700_000);
  });

  it("falls back to a nominal length for a track the play sweep has not seen", async () => {
    mockGetPlayHistory.mockResolvedValue([historyRow("1", "A", 1_770_000_000)]);

    await ingestUserListenHistory(1, "tok");

    const [stored] = episodesOf(
      await getSignalEvents(1, "plex_listen_history")
    );
    expect(stored.durationMs).toBe(NOMINAL_TRACK_MS);
  });

  it("carries the device and account through", async () => {
    mockGetPlayHistory.mockResolvedValue([
      historyRow("1", "A", 1_770_000_000, { deviceID: 77, accountID: 1 }),
    ]);

    await ingestUserListenHistory(1, "tok");

    const [stored] = episodesOf(
      await getSignalEvents(1, "plex_listen_history")
    );
    expect(stored).toMatchObject({ deviceID: 77, accountID: 1 });
  });

  it("chunks a large backfill and folds it back identically", async () => {
    mockGetPlayHistory.mockResolvedValue(
      Array.from({ length: 4500 }, (_, i) =>
        historyRow(String(i % 300), "A", 1_770_000_000 + i)
      )
    );

    expect(await ingestUserListenHistory(1, "tok")).toBe(4500);

    const events = await getSignalEvents(1, "plex_listen_history");
    expect(events.map((e) => episodesOf([e]).length)).toEqual([
      2000, 2000, 500,
    ]);
    expect(reconstructListenEpisodes(events, Infinity).size).toBe(4500);
  });
});
