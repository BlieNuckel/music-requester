import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_PROMOTED_ALBUM } from "../../../shared/settingsDefaults";

const mockGetConfigValue = vi.fn();
const mockGetAllUsers = vi.fn();
const mockListUserProfiles = vi.fn();
const mockGetSignalEvents = vi.fn();

vi.mock("../../config", () => ({
  getConfigValue: (...args: unknown[]) => mockGetConfigValue(...args),
}));

vi.mock("../../auth/users", () => ({
  getAllUsers: () => mockGetAllUsers(),
}));

vi.mock("../../db/userProfile", async () => {
  const actual = await vi.importActual<typeof import("../../db/userProfile")>(
    "../../db/userProfile"
  );
  return {
    computeConfigHash: actual.computeConfigHash,
    parseDerivedProfile: actual.parseDerivedProfile,
    listUserProfiles: () => mockListUserProfiles(),
    getSignalEvents: (...args: unknown[]) => mockGetSignalEvents(...args),
  };
});

const { computeConfigHash } = await import("../../db/userProfile");
const { DERIVED_PROFILE_SCHEMA_VERSION } =
  await import("../../db/entity/UserProfile");
const { getProfileDebugSummaries } = await import("./debugSummary");

const AT = "2026-08-18T10:00:00.000Z";

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    username: "lasse",
    hasPlexToken: true,
    ...overrides,
  };
}

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    user_id: 1,
    profile_json: JSON.stringify({
      genreVector: [
        { tag: "shoegaze", weight: 120.4, fromArtists: ["Slowdive"] },
        { tag: "dream pop", weight: 60, fromArtists: [] },
      ],
      artistTags: [
        { name: "Slowdive", viewCount: 90, tags: [] },
        { name: "Ride", viewCount: 120, tags: [] },
      ],
      similarGraph: [
        {
          seedArtist: "Ride",
          seedMbid: "m",
          seedGenres: [],
          viewCount: 1,
          candidates: [{ name: "Lush", artistMbid: "l", score: 1, genres: [] }],
        },
      ],
      knownAlbums: ["ride::nowhere"],
      explorationHistory: { albums: ["a"], artists: ["b", "c"] },
    }),
    schema_version: DERIVED_PROFILE_SCHEMA_VERSION,
    config_hash: computeConfigHash(DEFAULT_PROMOTED_ALBUM),
    generated_at: AT,
    last_used_at: AT,
    ...overrides,
  };
}

function listenHistory(
  episodes: { ratingKey: string; viewedAt: number; durationMs: number }[],
  recordedAt = AT
) {
  return {
    id: 1,
    user_id: 1,
    kind: "plex_listen_history",
    recorded_at: recordedAt,
    payload: JSON.stringify({
      episodes: episodes.map((episode) => ({
        ratingKey: episode.ratingKey,
        title: `Track ${episode.ratingKey}`,
        artistKey: "artist-1",
        artistName: "Slowdive",
        albumKey: "album-1",
        albumTitle: "Souvlaki",
        viewedAt: episode.viewedAt,
        startedAt: episode.viewedAt * 1000 - episode.durationMs / 2,
        durationMs: episode.durationMs,
        listenedMs: episode.durationMs,
        measured: false,
      })),
    }),
  };
}

function trackPlays(
  tracks: { ratingKey: string; playCount: number; artistKey?: string }[],
  recordedAt = AT
) {
  return {
    id: 1,
    user_id: 1,
    kind: "plex_track_plays",
    recorded_at: recordedAt,
    payload: JSON.stringify({
      tracks: tracks.map((track) => ({
        ratingKey: track.ratingKey,
        title: `Track ${track.ratingKey}`,
        artistKey: track.artistKey ?? "artist-1",
        artistName: "Slowdive",
        albumKey: "album-1",
        albumTitle: "Souvlaki",
        playCount: track.playCount,
      })),
    }),
  };
}

function rating(ratingKey: string, recordedAt = AT) {
  return {
    id: 2,
    user_id: 1,
    kind: "plex_rating",
    recorded_at: recordedAt,
    payload: JSON.stringify({
      ratingKey,
      kind: "album",
      title: "Souvlaki",
      artist: "Slowdive",
      rating: 10,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConfigValue.mockReturnValue(DEFAULT_PROMOTED_ALBUM);
  mockGetAllUsers.mockResolvedValue([user()]);
  mockListUserProfiles.mockResolvedValue([]);
  mockGetSignalEvents.mockResolvedValue([]);
});

describe("getProfileDebugSummaries", () => {
  it("reports a user with no profile and no signals", async () => {
    const [entry] = await getProfileDebugSummaries();

    expect(entry).toMatchObject({
      userId: 1,
      username: "lasse",
      hasPlexToken: true,
      profile: null,
      signals: [],
      recentSignals: [],
      plex: { trackedTracks: 0, totalPlays: 0, artists: 0, ratedItems: 0 },
    });
  });

  it("includes users who have no Plex token, so the gap is visible", async () => {
    mockGetAllUsers.mockResolvedValue([
      user({ id: 2, username: "local", hasPlexToken: false }),
    ]);

    const [entry] = await getProfileDebugSummaries();
    expect(entry.hasPlexToken).toBe(false);
  });

  it("counts the parts of the derived document", async () => {
    mockListUserProfiles.mockResolvedValue([profileRow()]);

    const [entry] = await getProfileDebugSummaries();

    expect(entry.profile?.counts).toEqual({
      genres: 2,
      artists: 2,
      similarSeeds: 1,
      similarCandidates: 1,
      knownAlbums: 1,
      exploredAlbums: 1,
      exploredArtists: 2,
    });
  });

  it("lists top genres in stored order and artists by plays", async () => {
    mockListUserProfiles.mockResolvedValue([profileRow()]);

    const [entry] = await getProfileDebugSummaries();

    expect(entry.profile?.topGenres[0].tag).toBe("shoegaze");
    expect(entry.profile?.topArtists.map((a) => a.name)).toEqual([
      "Ride",
      "Slowdive",
    ]);
  });

  it("calls a profile fresh when hash and schema match the current ones", async () => {
    mockListUserProfiles.mockResolvedValue([profileRow()]);

    const [entry] = await getProfileDebugSummaries();
    expect(entry.profile?.stale).toBe(false);
  });

  it("flags a profile built under a different config", async () => {
    mockListUserProfiles.mockResolvedValue([
      profileRow({ config_hash: "something-else" }),
    ]);

    const [entry] = await getProfileDebugSummaries();
    expect(entry.profile?.stale).toBe(true);
  });

  it("flags a profile from an older schema", async () => {
    mockListUserProfiles.mockResolvedValue([
      profileRow({ schema_version: DERIVED_PROFILE_SCHEMA_VERSION - 1 }),
    ]);

    const [entry] = await getProfileDebugSummaries();
    expect(entry.profile?.stale).toBe(true);
  });

  it("flags a profile whose vector never built", async () => {
    mockListUserProfiles.mockResolvedValue([
      profileRow({
        profile_json: JSON.stringify({
          genreVector: [],
          artistTags: [],
          similarGraph: [],
          knownAlbums: [],
          explorationHistory: { albums: [], artists: [] },
        }),
      }),
    ]);

    const [entry] = await getProfileDebugSummaries();
    expect(entry.profile?.stale).toBe(true);
  });

  it("folds the play series into current totals", async () => {
    mockGetSignalEvents.mockResolvedValue([
      trackPlays([
        { ratingKey: "t1", playCount: 3 },
        { ratingKey: "t2", playCount: 1 },
      ]),
      trackPlays(
        [{ ratingKey: "t1", playCount: 5 }],
        "2026-08-18T11:00:00.000Z"
      ),
    ]);

    const [entry] = await getProfileDebugSummaries();

    expect(entry.plex).toEqual({
      trackedTracks: 2,
      totalPlays: 6,
      artists: 1,
      ratedItems: 0,
      listenEpisodes: 0,
      listenedHours: 0,
    });
  });

  it("folds the episode series into a count and total listening", async () => {
    mockGetSignalEvents.mockResolvedValue([
      listenHistory([
        { ratingKey: "t1", viewedAt: 1_770_000_000, durationMs: 3_600_000 },
        { ratingKey: "t1", viewedAt: 1_770_010_000, durationMs: 3_600_000 },
        { ratingKey: "t2", viewedAt: 1_770_020_000, durationMs: 1_800_000 },
      ]),
    ]);

    const [entry] = await getProfileDebugSummaries();

    expect(entry.plex.listenEpisodes).toBe(3);
    expect(entry.plex.listenedHours).toBe(2);
  });

  it("counts a rating once however many times it was rewritten", async () => {
    mockGetSignalEvents.mockResolvedValue([
      rating("r1"),
      rating("r1", "2026-08-18T11:00:00.000Z"),
      rating("r2", "2026-08-18T12:00:00.000Z"),
    ]);

    const [entry] = await getProfileDebugSummaries();
    expect(entry.plex.ratedItems).toBe(2);
  });

  it("summarizes each signal kind's extent", async () => {
    mockGetSignalEvents.mockResolvedValue([
      trackPlays(
        [{ ratingKey: "t1", playCount: 1 }],
        "2026-08-16T10:00:00.000Z"
      ),
      trackPlays(
        [{ ratingKey: "t2", playCount: 1 }],
        "2026-08-17T10:00:00.000Z"
      ),
      rating("r1", "2026-08-18T10:00:00.000Z"),
    ]);

    const [entry] = await getProfileDebugSummaries();

    expect(entry.signals).toEqual([
      {
        kind: "plex_rating",
        count: 1,
        firstAt: "2026-08-18T10:00:00.000Z",
        lastAt: "2026-08-18T10:00:00.000Z",
      },
      {
        kind: "plex_track_plays",
        count: 2,
        firstAt: "2026-08-16T10:00:00.000Z",
        lastAt: "2026-08-17T10:00:00.000Z",
      },
    ]);
  });

  it("lists the most recent writes newest first with their delta size", async () => {
    mockGetSignalEvents.mockResolvedValue([
      trackPlays(
        [{ ratingKey: "t1", playCount: 1 }],
        "2026-08-16T10:00:00.000Z"
      ),
      trackPlays([], "2026-08-17T10:00:00.000Z"),
    ]);

    const [entry] = await getProfileDebugSummaries();

    expect(entry.recentSignals).toEqual([
      {
        kind: "plex_track_plays",
        recordedAt: "2026-08-17T10:00:00.000Z",
        changed: 0,
      },
      {
        kind: "plex_track_plays",
        recordedAt: "2026-08-16T10:00:00.000Z",
        changed: 1,
      },
    ]);
  });

  it("counts a non-delta signal as one item", async () => {
    mockGetSignalEvents.mockResolvedValue([rating("r1")]);

    const [entry] = await getProfileDebugSummaries();
    expect(entry.recentSignals[0].changed).toBe(1);
  });

  it("matches each profile row to its own user", async () => {
    mockGetAllUsers.mockResolvedValue([
      user(),
      user({ id: 2, username: "other" }),
    ]);
    mockListUserProfiles.mockResolvedValue([profileRow({ user_id: 2 })]);

    const entries = await getProfileDebugSummaries();

    expect(entries[0].profile).toBeNull();
    expect(entries[1].profile).not.toBeNull();
    expect(mockGetSignalEvents).toHaveBeenCalledWith(1);
    expect(mockGetSignalEvents).toHaveBeenCalledWith(2);
  });
});
