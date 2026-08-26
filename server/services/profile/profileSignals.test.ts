import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetAllTrackPlayCounts = vi.fn();

vi.mock("../../api/plex/trackPlayCounts", () => ({
  getAllTrackPlayCounts: (...args: unknown[]) =>
    mockGetAllTrackPlayCounts(...args),
}));

import { foldSignalsToNow, loadProfileSignals } from "./profileSignals";
import { initializeDatabase, closeDatabase, getDataSource } from "../../db";
import { appendSignalEvent } from "../../db/userProfile";
import type { ProfileSignals } from "./profileSignals";
import type { UserSignalEvent } from "../../db/entity/UserSignalEvent";

type TrackSpec = {
  ratingKey: string;
  artistName: string;
  playCount: number;
  albumKey?: string;
  albumTitle?: string;
};

function trackEvent(tracks: TrackSpec[]): UserSignalEvent {
  return {
    id: 0,
    user_id: 1,
    kind: "plex_track_plays",
    payload: JSON.stringify({
      tracks: tracks.map((track) => ({
        ratingKey: track.ratingKey,
        title: `t${track.ratingKey}`,
        artistKey: `ak-${track.artistName}`,
        artistName: track.artistName,
        albumKey: track.albumKey ?? "alb",
        albumTitle: track.albumTitle ?? "Album",
        playCount: track.playCount,
      })),
    }),
    recorded_at: "2026-06-01T00:00:00.000Z",
  } as UserSignalEvent;
}

function event(kind: string, payload: unknown): UserSignalEvent {
  return {
    id: 0,
    user_id: 1,
    kind,
    payload: JSON.stringify(payload),
    recorded_at: "2026-06-01T00:00:00.000Z",
  } as UserSignalEvent;
}

const signals = (overrides: Partial<ProfileSignals> = {}): ProfileSignals => ({
  trackEvents: [],
  ratingEvents: [],
  albumEvents: [],
  episodes: new Map(),
  ...overrides,
});

describe("foldSignalsToNow", () => {
  it("replays the play series to its current state", () => {
    const folded = foldSignalsToNow(
      signals({
        trackEvents: [
          trackEvent([{ ratingKey: "1", artistName: "A", playCount: 4 }]),
          trackEvent([{ ratingKey: "1", artistName: "A", playCount: 9 }]),
        ],
      })
    );

    expect(folded.tracks.get("1")?.playCount).toBe(9);
  });

  it("keeps only the latest rating known for each item", () => {
    const folded = foldSignalsToNow(
      signals({
        ratingEvents: [
          event("plex_rating", {
            ratingKey: "r1",
            kind: "track",
            title: "t",
            artist: "A",
            rating: 4,
          }),
          event("plex_rating", {
            ratingKey: "r1",
            kind: "track",
            title: "t",
            artist: "A",
            rating: 10,
          }),
        ],
      })
    );

    expect(folded.ratings.get("r1")?.rating).toBe(10);
  });

  it("keeps Plex genres only for albums that carry any", () => {
    const folded = foldSignalsToNow(
      signals({
        albumEvents: [
          event("plex_album_tracks", {
            albums: [
              { ratingKey: "a1", title: "One", trackCount: 9, genres: ["dub"] },
              { ratingKey: "a2", title: "Two", trackCount: 4, genres: [] },
            ],
          }),
        ],
      })
    );

    expect(folded.albumGenres.get("a1")).toEqual(["dub"]);
    expect(folded.albumGenres.has("a2")).toBe(false);
  });

  it("folds an empty log to empty state rather than throwing", () => {
    const folded = foldSignalsToNow(signals());

    expect(folded.tracks.size).toBe(0);
    expect(folded.ratings.size).toBe(0);
    expect(folded.albumGenres.size).toBe(0);
  });
});

describe("loadProfileSignals", () => {
  beforeEach(async () => {
    await initializeDatabase(":memory:");
    await getDataSource().query("INSERT INTO users (username) VALUES ('a')");
    mockGetAllTrackPlayCounts.mockReset();
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it("reads every series the build needs", async () => {
    await appendSignalEvent(1, "plex_track_plays", {
      tracks: [
        {
          ratingKey: "1",
          title: "t1",
          artistKey: "ak",
          artistName: "A",
          albumKey: "alb",
          albumTitle: "Album",
          playCount: 3,
        },
      ],
    });
    await appendSignalEvent(1, "plex_rating", {
      ratingKey: "r1",
      kind: "track",
      title: "t1",
      artist: "A",
      rating: 8,
    });
    await appendSignalEvent(1, "plex_album_tracks", { albums: [] });

    const loaded = await loadProfileSignals(1, "tok");

    expect(loaded.trackEvents).toHaveLength(1);
    expect(loaded.ratingEvents).toHaveLength(1);
    expect(loaded.albumEvents).toHaveLength(1);
    expect(mockGetAllTrackPlayCounts).not.toHaveBeenCalled();
  });

  it("ingests on demand for a user with no play captures at all", async () => {
    mockGetAllTrackPlayCounts.mockResolvedValue([
      {
        ratingKey: "1",
        title: "t1",
        artistKey: "ak",
        artistName: "A",
        albumKey: "alb",
        albumTitle: "Album",
        viewCount: 2,
        durationMs: 0,
      },
    ]);

    const loaded = await loadProfileSignals(1, "tok");

    expect(mockGetAllTrackPlayCounts).toHaveBeenCalledTimes(1);
    expect(loaded.trackEvents).toHaveLength(1);
  });

  it("scopes the read to the user asking", async () => {
    await getDataSource().query("INSERT INTO users (username) VALUES ('b')");
    await appendSignalEvent(2, "plex_rating", {
      ratingKey: "r1",
      kind: "track",
      title: "t1",
      artist: "A",
      rating: 8,
    });
    mockGetAllTrackPlayCounts.mockResolvedValue([]);

    const loaded = await loadProfileSignals(1, "tok");

    expect(loaded.ratingEvents).toEqual([]);
  });
});
