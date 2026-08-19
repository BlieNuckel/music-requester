import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  measuredEpisodeKey,
  mergeMeasuredEpisodes,
  observeSessions,
  reconstructMeasuredEpisodes,
  recordMeasuredEpisodes,
  resetWatches,
  retireWatches,
  watchKey,
} from "./listenSessions";
import { initializeDatabase, closeDatabase, getDataSource } from "../../db";
import { getSignalEvents } from "../../db/userProfile";
import type { PlexTrackSession } from "../../api/plex/sessions";
import type { ListenEpisode } from "./listenHistory";
import type { UserSignalEvent } from "../../db/entity/UserSignalEvent";

const T0 = 1_770_000_000_000;

function session(overrides: Partial<PlexTrackSession> = {}): PlexTrackSession {
  return {
    sessionKey: "12",
    ratingKey: "451",
    title: "Antwerp Expo",
    artistKey: "art1",
    artistName: "Andromedik",
    albumKey: "alb1",
    albumTitle: "Live Sets",
    durationMs: 5_448_000,
    viewOffsetMs: 0,
    machineIdentifier: "device-1",
    product: "Plexamp",
    state: "playing",
    ...overrides,
  };
}

function episode(
  ratingKey: string,
  startedAt: number,
  overrides: Partial<ListenEpisode> = {}
): ListenEpisode {
  return {
    ratingKey,
    title: `t${ratingKey}`,
    artistKey: "art1",
    artistName: "Andromedik",
    albumKey: "alb1",
    albumTitle: "Live Sets",
    startedAt,
    durationMs: 210_000,
    listenedMs: 210_000,
    measured: false,
    ...overrides,
  };
}

function episodeEvent(episodes: ListenEpisode[]): UserSignalEvent {
  return {
    payload: JSON.stringify({ episodes }),
    recorded_at: "2026-01-01T00:00:00.000Z",
  } as UserSignalEvent;
}

/** Run one poll and return whatever it retired. */
function poll(
  userId: number,
  sessions: PlexTrackSession[],
  now: number
): ListenEpisode[] {
  return retireWatches(userId, observeSessions(userId, sessions, now));
}

beforeEach(() => {
  resetWatches();
});

describe("observeSessions", () => {
  it("credits the ground the position actually covered", () => {
    poll(1, [session({ viewOffsetMs: 0 })], T0);
    poll(1, [session({ viewOffsetMs: 10_000 })], T0 + 10_000);
    const [committed] = poll(1, [], T0 + 20_000);

    expect(committed.listenedMs).toBe(10_000);
    expect(committed.measured).toBe(true);
  });

  it("credits nothing while the position stands still", () => {
    poll(1, [session({ viewOffsetMs: 60_000 })], T0);
    poll(1, [session({ viewOffsetMs: 60_000 })], T0 + 10_000);
    poll(1, [session({ viewOffsetMs: 90_000 })], T0 + 40_000);
    const [committed] = poll(1, [], T0 + 50_000);

    expect(committed.listenedMs).toBe(30_000);
  });

  it("credits nothing for a seek forward, which is not listening", () => {
    poll(1, [session({ viewOffsetMs: 0 })], T0);
    poll(1, [session({ viewOffsetMs: 2_800_000 })], T0 + 5_000);
    poll(1, [session({ viewOffsetMs: 2_810_000 })], T0 + 15_000);
    const [committed] = poll(1, [], T0 + 20_000);

    expect(committed.listenedMs).toBe(10_000);
  });

  it("credits nothing for a scrub backwards and re-bases on the new position", () => {
    poll(1, [session({ viewOffsetMs: 100_000 })], T0);
    poll(1, [session({ viewOffsetMs: 10_000 })], T0 + 5_000);
    poll(1, [session({ viewOffsetMs: 20_000 })], T0 + 15_000);
    const [committed] = poll(1, [], T0 + 20_000);

    expect(committed.listenedMs).toBe(10_000);
  });

  it("believes the position over a client that claims to be paused", () => {
    poll(1, [session({ viewOffsetMs: 0, state: "paused" })], T0);
    poll(1, [session({ viewOffsetMs: 10_000, state: "paused" })], T0 + 10_000);
    const [committed] = poll(1, [], T0 + 20_000);

    expect(committed.listenedMs).toBe(10_000);
  });

  it("back-derives the start from the position it was first seen at", () => {
    poll(1, [session({ viewOffsetMs: 45_000 })], T0);
    poll(1, [session({ viewOffsetMs: 55_000 })], T0 + 10_000);
    const [committed] = poll(1, [], T0 + 20_000);

    expect(committed.startedAt).toBe(T0 - 45_000);
  });

  it("tracks the same track on two clients separately", () => {
    const other = session({ machineIdentifier: "device-2", sessionKey: "13" });
    poll(1, [session({ viewOffsetMs: 0 }), { ...other, viewOffsetMs: 0 }], T0);
    poll(
      1,
      [session({ viewOffsetMs: 10_000 }), { ...other, viewOffsetMs: 30_000 }],
      T0 + 30_000
    );
    const committed = poll(1, [], T0 + 40_000);

    expect(committed.map((e) => e.listenedMs).sort()).toEqual([10_000, 30_000]);
  });

  it("keeps one user's windows out of another's", () => {
    poll(1, [session({ viewOffsetMs: 0 })], T0);
    poll(2, [session({ viewOffsetMs: 0 })], T0);
    poll(1, [session({ viewOffsetMs: 10_000 })], T0 + 10_000);

    expect(poll(1, [], T0 + 20_000)).toHaveLength(1);
    expect(retireWatches(2, new Set())).toHaveLength(0);
  });

  it("keys a watch by client, session and track", () => {
    expect(watchKey(1, session())).toBe("1:device-1:12:451");
  });
});

describe("retireWatches", () => {
  it("commits a window abandoned long before any play would have", () => {
    poll(1, [session({ viewOffsetMs: 0 })], T0);
    poll(1, [session({ viewOffsetMs: 720_000 })], T0 + 720_000);
    const [committed] = poll(1, [], T0 + 730_000);

    expect(committed.listenedMs).toBe(720_000);
    expect(committed.listenedMs).toBeLessThan(committed.durationMs / 2);
  });

  it("drops a window too short to tell apart from poll noise", () => {
    poll(1, [session({ viewOffsetMs: 0 })], T0);
    poll(1, [session({ viewOffsetMs: 1_000 })], T0 + 1_000);

    expect(poll(1, [], T0 + 6_000)).toEqual([]);
  });

  it("leaves a window still playing alone", () => {
    poll(1, [session({ viewOffsetMs: 0 })], T0);

    expect(poll(1, [session({ viewOffsetMs: 30_000 })], T0 + 30_000)).toEqual(
      []
    );
  });
});

describe("recordMeasuredEpisodes (with DB)", () => {
  beforeEach(async () => {
    await initializeDatabase(":memory:");
    await getDataSource().query("INSERT INTO users (username) VALUES (?)", [
      "alice",
    ]);
  });
  afterEach(async () => {
    await closeDatabase();
  });

  it("appends the episodes that just ended", async () => {
    expect(
      await recordMeasuredEpisodes(1, [episode("451", T0, { measured: true })])
    ).toBe(1);

    const events = await getSignalEvents(1, "plex_listen_sessions");
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].payload).episodes[0]).toMatchObject({
      ratingKey: "451",
      measured: true,
    });
  });

  it("writes nothing when there is nothing to record", async () => {
    expect(await recordMeasuredEpisodes(1, [])).toBe(0);
    expect(await getSignalEvents(1, "plex_listen_sessions")).toHaveLength(0);
  });

  it("skips an episode already stored for that track and start", async () => {
    const committed = episode("451", T0, { measured: true });
    await recordMeasuredEpisodes(1, [committed]);

    expect(await recordMeasuredEpisodes(1, [committed])).toBe(0);
    expect(await getSignalEvents(1, "plex_listen_sessions")).toHaveLength(1);
  });
});

describe("reconstructMeasuredEpisodes", () => {
  it("keys episodes on the track and its start", () => {
    const stored = reconstructMeasuredEpisodes(
      [
        episodeEvent([
          episode("451", T0, { measured: true }),
          episode("451", T0 + 600_000, { measured: true }),
        ]),
      ],
      Infinity
    );

    expect(stored.size).toBe(2);
    expect(stored.has(measuredEpisodeKey("451", T0))).toBe(true);
  });
});

describe("mergeMeasuredEpisodes", () => {
  it("replaces the inferred time on the play it witnessed", () => {
    const history = new Map([["451:1770000105", episode("451", T0)]]);
    const measured = new Map([
      [
        measuredEpisodeKey("451", T0 + 4_000),
        episode("451", T0 + 4_000, { listenedMs: 120_000, measured: true }),
      ],
    ]);

    const merged = mergeMeasuredEpisodes(history, measured);

    expect(merged.size).toBe(1);
    expect(merged.get("451:1770000105")).toMatchObject({
      listenedMs: 120_000,
      measured: true,
    });
  });

  it("keeps a measured episode that matched no play at all", () => {
    const history = new Map([["451:1770000105", episode("451", T0)]]);
    const abandoned = episode("999", T0, {
      listenedMs: 30_000,
      measured: true,
    });

    const merged = mergeMeasuredEpisodes(
      history,
      new Map([[measuredEpisodeKey("999", T0), abandoned]])
    );

    expect(merged.size).toBe(2);
    expect(merged.get(measuredEpisodeKey("999", T0))).toBe(abandoned);
  });

  it("does not join a play of the same track from another day", () => {
    const history = new Map([["451:1770000105", episode("451", T0)]]);
    const later = episode("451", T0 + 24 * 60 * 60 * 1000, {
      listenedMs: 90_000,
      measured: true,
    });

    const merged = mergeMeasuredEpisodes(
      history,
      new Map([[measuredEpisodeKey("451", later.startedAt), later]])
    );

    expect(merged.size).toBe(2);
    expect(merged.get("451:1770000105")?.measured).toBe(false);
  });

  it("leaves history untouched when nothing was measured", () => {
    const history = new Map([["451:1770000105", episode("451", T0)]]);

    expect(mergeMeasuredEpisodes(history, new Map())).toEqual(history);
  });
});
