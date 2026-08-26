import { describe, it, expect } from "vitest";
import {
  allTimeListening,
  artistRollupsByName,
  deriveKnownAlbums,
  resolveListeningWindow,
  rollupWindowToAlbums,
  rollupWindowToArtists,
  type WindowedPlay,
} from "./listeningWindow";
import { NOMINAL_TRACK_MS } from "./signalIngestion";
import type { ListenEpisode } from "./listenHistory";
import type { UserSignalEvent } from "../../db/entity/UserSignalEvent";

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
const NOW = Date.parse("2026-06-28T00:00:00.000Z");

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
        durationMs: track.durationMs ?? 0,
      })),
    }),
    recorded_at: new Date(NOW - daysAgo * DAY).toISOString(),
  } as UserSignalEvent;
}

function episode(
  ratingKey: string,
  artistName: string,
  daysAgo: number,
  listenedMs = NOMINAL_TRACK_MS
): ListenEpisode {
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

const episodes = (...items: ListenEpisode[]): Map<string, ListenEpisode> =>
  new Map(items.map((item, index) => [`e${index}`, item]));

const options = (overrides = {}) => ({
  now: NOW,
  windowMs: 30 * DAY,
  capMs: 0,
  ...overrides,
});

/** The window always reads the all-time fold the rest of the build already holds. */
const resolveWindow = (
  trackEvents: UserSignalEvent[],
  episodes: Map<string, ListenEpisode>,
  opts: ReturnType<typeof options>
) =>
  resolveListeningWindow(
    trackEvents,
    episodes,
    allTimeListening(trackEvents, opts.capMs),
    opts
  );

describe("resolveListeningWindow", () => {
  it("measures the window as the increase since it opened", () => {
    const window = resolveWindow(
      [
        trackEvent([{ ratingKey: "1", artistName: "A", playCount: 10 }], 40),
        trackEvent([{ ratingKey: "1", artistName: "A", playCount: 30 }], 0),
      ],
      new Map(),
      options()
    );

    expect(window.source).toBe("deltas");
    expect(window.startMs).toBe(NOW - 30 * DAY);
    expect(window.plays.get("1")?.plays).toBe(20);
  });

  it("prefers the episode log wherever it reaches back far enough", () => {
    const window = resolveWindow(
      [trackEvent([{ ratingKey: "1", artistName: "A", playCount: 40 }], 60)],
      episodes(episode("1", "A", 40), episode("1", "A", 10)),
      options()
    );

    expect(window.source).toBe("episodes");
    expect(window.plays.get("1")?.plays).toBe(1);
  });

  it("counts a play once, not once per series", () => {
    const window = resolveWindow(
      [
        trackEvent([{ ratingKey: "1", artistName: "A", playCount: 0 }], 60),
        trackEvent([{ ratingKey: "1", artistName: "A", playCount: 5 }], 0),
      ],
      episodes(episode("1", "A", 40), episode("1", "A", 10)),
      options()
    );

    expect(window.plays.get("1")?.plays).toBe(1);
  });

  it("falls back to the deltas when history starts inside the window", () => {
    const window = resolveWindow(
      [
        trackEvent([{ ratingKey: "1", artistName: "A", playCount: 10 }], 60),
        trackEvent([{ ratingKey: "1", artistName: "A", playCount: 14 }], 0),
      ],
      episodes(episode("1", "A", 10)),
      options()
    );

    expect(window.source).toBe("deltas");
    expect(window.plays.get("1")?.plays).toBe(4);
  });

  it("falls back to all-time until the series is deep enough", () => {
    const window = resolveWindow(
      [trackEvent([{ ratingKey: "1", artistName: "A", playCount: 12 }], 5)],
      new Map(),
      options()
    );

    expect(window.source).toBe("allTime");
    expect(window.startMs).toBeNull();
    expect(window.plays.get("1")?.plays).toBe(12);
  });

  it("falls back to all-time when nothing was played in the window", () => {
    const window = resolveWindow(
      [
        trackEvent([{ ratingKey: "1", artistName: "A", playCount: 10 }], 40),
        trackEvent([{ ratingKey: "1", artistName: "A", playCount: 10 }], 0),
      ],
      new Map(),
      options()
    );

    expect(window.source).toBe("allTime");
    expect(window.plays.get("1")?.plays).toBe(10);
  });

  it("ignores episodes started outside the window", () => {
    const window = resolveWindow(
      [trackEvent([{ ratingKey: "1", artistName: "A", playCount: 1 }], 60)],
      episodes(episode("1", "A", 40)),
      options()
    );

    expect(window.source).toBe("allTime");
  });

  it("keeps a track played only before the window, at zero", () => {
    const window = resolveWindow(
      [
        trackEvent(
          [
            { ratingKey: "1", artistName: "A", playCount: 10 },
            { ratingKey: "2", artistName: "A", playCount: 4 },
          ],
          40
        ),
        trackEvent([{ ratingKey: "1", artistName: "A", playCount: 30 }], 0),
      ],
      new Map(),
      options()
    );

    expect(window.plays.get("2")?.plays).toBe(0);
  });

  it("caps what one play of a very long track is worth", () => {
    const window = resolveWindow(
      [
        trackEvent(
          [
            {
              ratingKey: "1",
              artistName: "A",
              playCount: 2,
              durationMs: 5_400_000,
            },
          ],
          5
        ),
      ],
      new Map(),
      options({ capMs: 600_000 })
    );

    expect(window.plays.get("1")?.listenedMs).toBe(1_200_000);
  });

  it("caps what one very long episode is worth", () => {
    const window = resolveWindow(
      [trackEvent([{ ratingKey: "1", artistName: "A", playCount: 1 }], 60)],
      episodes(episode("1", "A", 40), episode("1", "A", 10, 5_400_000)),
      options({ capMs: 600_000 })
    );

    expect(window.plays.get("1")?.listenedMs).toBe(600_000);
  });

  it("returns an empty window when the play series has no captures", () => {
    const window = resolveWindow([], episodes(episode("1", "A", 1)), {
      ...options(),
    });

    expect(window.source).toBe("allTime");
    expect(window.plays.size).toBe(0);
  });
});

describe("allTimeListening", () => {
  it("applies no window at all", () => {
    const rows = allTimeListening(
      [trackEvent([{ ratingKey: "1", artistName: "A", playCount: 10 }], 400)],
      0
    );

    expect(rows.get("1")?.plays).toBe(10);
  });
});

describe("rollupWindowToArtists", () => {
  const row = (overrides: Partial<WindowedPlay>): WindowedPlay => ({
    ratingKey: "1",
    artistKey: "ak",
    artistName: "A",
    albumKey: "alb",
    albumTitle: "Album",
    plays: 1,
    listenedMs: NOMINAL_TRACK_MS,
    ...overrides,
  });

  const rows = (...items: WindowedPlay[]) =>
    new Map(items.map((item) => [item.ratingKey, item]));

  it("sums plays and listening per artist", () => {
    const [artist] = rollupWindowToArtists(
      rows(row({ ratingKey: "1", plays: 4 }), row({ ratingKey: "2", plays: 6 }))
    );

    expect(artist.playCount).toBe(10);
    expect(artist.distinctTracksPlayed).toBe(2);
  });

  it("does not count an unplayed track as a track played", () => {
    const [artist] = rollupWindowToArtists(
      rows(row({ ratingKey: "1", plays: 3 }), row({ ratingKey: "2", plays: 0 }))
    );

    expect(artist.distinctTracksPlayed).toBe(1);
  });

  it("groups by artistKey so a rename keeps one bucket", () => {
    const rollups = rollupWindowToArtists(
      rows(
        row({ ratingKey: "1", artistKey: "k1", artistName: "Old", plays: 3 }),
        row({ ratingKey: "2", artistKey: "k1", artistName: "New", plays: 5 })
      )
    );

    expect(rollups).toHaveLength(1);
    expect(rollups[0].playCount).toBe(8);
  });

  it("keeps same-named artists separate when their keys differ", () => {
    const rollups = rollupWindowToArtists(
      rows(
        row({ ratingKey: "1", artistKey: "k1", plays: 3 }),
        row({ ratingKey: "2", artistKey: "k2", plays: 5 })
      )
    );

    expect(rollups).toHaveLength(2);
  });

  it("names the most-played track as the top one", () => {
    const [artist] = rollupWindowToArtists(
      rows(row({ ratingKey: "1", plays: 2 }), row({ ratingKey: "2", plays: 9 }))
    );

    expect(artist.topTrackKey).toBe("2");
  });
});

describe("artistRollupsByName", () => {
  it("collapses same-named artists to the busier, whole", () => {
    const byName = artistRollupsByName([
      {
        artistKey: "k1",
        name: "Nova",
        playCount: 3,
        listenedMs: 300,
        distinctTracksPlayed: 3,
        topTrackPlayCount: 1,
        topTrackListenedMs: 100,
        topTrackKey: "a",
      },
      {
        artistKey: "k2",
        name: "Nova",
        playCount: 5,
        listenedMs: 900,
        distinctTracksPlayed: 1,
        topTrackPlayCount: 5,
        topTrackListenedMs: 900,
        topTrackKey: "b",
      },
    ]);

    expect(byName.get("Nova")).toMatchObject({
      playCount: 5,
      distinctTracksPlayed: 1,
      topTrackKey: "b",
    });
  });
});

describe("rollupWindowToAlbums", () => {
  it("sums an album's tracks and drops rows with no album at all", () => {
    const albums = rollupWindowToAlbums(
      new Map([
        [
          "1",
          {
            ratingKey: "1",
            artistKey: "ak",
            artistName: "A",
            albumKey: "alb",
            albumTitle: "Album",
            plays: 2,
            listenedMs: 200,
          },
        ],
        [
          "2",
          {
            ratingKey: "2",
            artistKey: "ak",
            artistName: "A",
            albumKey: "alb",
            albumTitle: "Album",
            plays: 3,
            listenedMs: 300,
          },
        ],
        [
          "3",
          {
            ratingKey: "3",
            artistKey: "ak",
            artistName: "A",
            albumKey: "",
            albumTitle: "",
            plays: 9,
            listenedMs: 900,
          },
        ],
      ])
    );

    expect(albums).toHaveLength(1);
    expect(albums[0]).toMatchObject({
      plays: 5,
      listenedMs: 500,
      distinctTracksPlayed: 2,
    });
  });
});

describe("deriveKnownAlbums", () => {
  const albumRow = (
    ratingKey: string,
    albumTitle: string,
    plays: number
  ): WindowedPlay => ({
    ratingKey,
    artistKey: "ak",
    artistName: "A",
    albumKey: `alb-${albumTitle}`,
    albumTitle,
    plays,
    listenedMs: plays * NOMINAL_TRACK_MS,
  });

  const tracks = (...rows: WindowedPlay[]) =>
    new Map(rows.map((row) => [row.ratingKey, row]));

  it("counts a record played across several of its tracks", () => {
    expect(
      deriveKnownAlbums(
        tracks(albumRow("1", "Souvlaki", 3), albumRow("2", "Souvlaki", 2))
      )
    ).toEqual(["a::souvlaki"]);
  });

  it("does not call a record known off one track on repeat", () => {
    expect(deriveKnownAlbums(tracks(albumRow("1", "Souvlaki", 40)))).toEqual(
      []
    );
  });

  it("leaves a barely-played record out", () => {
    expect(
      deriveKnownAlbums(
        tracks(albumRow("1", "Souvlaki", 1), albumRow("2", "Souvlaki", 1))
      )
    ).toEqual([]);
  });

  it("orders by plays and caps the list", () => {
    expect(
      deriveKnownAlbums(
        tracks(
          albumRow("1", "Quiet", 3),
          albumRow("2", "Quiet", 3),
          albumRow("3", "Loud", 20),
          albumRow("4", "Loud", 20)
        ),
        5,
        1
      )
    ).toEqual(["a::loud"]);
  });

  it("drops a record with no title to key on", () => {
    expect(deriveKnownAlbums(tracks(albumRow("1", "", 9)))).toEqual([]);
  });
});
