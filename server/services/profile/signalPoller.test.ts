import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetConfigValue = vi.fn();
const mockGetRatedItems = vi.fn();
const mockGetAllTrackPlayCounts = vi.fn();
const mockGetAllAlbumTrackCounts = vi.fn();
const mockGetPlayHistory = vi.fn();

vi.mock("../../config", () => ({
  getConfigValue: (...args: unknown[]) => mockGetConfigValue(...args),
}));
vi.mock("../../api/plex/ratings", () => ({
  getRatedItems: (...args: unknown[]) => mockGetRatedItems(...args),
}));
vi.mock("../../api/plex/trackPlayCounts", () => ({
  getAllTrackPlayCounts: (...args: unknown[]) =>
    mockGetAllTrackPlayCounts(...args),
}));
vi.mock("../../api/plex/albumTrackCounts", () => ({
  getAllAlbumTrackCounts: (...args: unknown[]) =>
    mockGetAllAlbumTrackCounts(...args),
}));
vi.mock("../../api/plex/playHistory", () => ({
  getPlayHistory: (...args: unknown[]) => mockGetPlayHistory(...args),
}));

import { runSignalIngestionOnce } from "./signalPoller";
import { initializeDatabase, closeDatabase, getDataSource } from "../../db";
import { getSignalEvents } from "../../db/userProfile";

async function createUser(
  username: string,
  plexToken: string | null,
  enabled = 1
): Promise<void> {
  await getDataSource().query(
    "INSERT INTO users (username, plex_token, enabled) VALUES (?, ?, ?)",
    [username, plexToken, enabled]
  );
}

const ratedTrack = {
  ratingKey: "451",
  kind: "track" as const,
  title: "Air",
  artist: "Andromedik",
  rating: 10,
};

beforeEach(async () => {
  await initializeDatabase(":memory:");
  mockGetConfigValue.mockReturnValue({ ratingsBackupEnabled: true });
  mockGetRatedItems.mockResolvedValue([ratedTrack]);
  mockGetAllTrackPlayCounts.mockResolvedValue([
    {
      ratingKey: "451",
      title: "Air",
      artistKey: "art1",
      artistName: "Andromedik",
      albumKey: "alb1",
      albumTitle: "Prologue",
      viewCount: 120,
      durationMs: 210_000,
    },
  ]);
  mockGetPlayHistory.mockResolvedValue([
    {
      ratingKey: "451",
      title: "Air",
      artistKey: "art1",
      artistName: "Andromedik",
      albumKey: "alb1",
      albumTitle: "Prologue",
      viewedAt: 1_770_000_000,
    },
  ]);
  mockGetAllAlbumTrackCounts.mockResolvedValue([
    {
      ratingKey: "alb1",
      title: "Prologue",
      artistKey: "art1",
      artistName: "Andromedik",
      trackCount: 11,
    },
  ]);
});
afterEach(async () => {
  vi.clearAllMocks();
  await closeDatabase();
});

describe("runSignalIngestionOnce", () => {
  it("ingests ratings + a plays capture for every enabled token-holding user", async () => {
    await createUser("alice", "tok-a");
    await createUser("bob", "tok-b");

    await runSignalIngestionOnce();

    for (const userId of [1, 2]) {
      expect(await getSignalEvents(userId, "plex_rating")).toHaveLength(1);
      expect(await getSignalEvents(userId, "plex_track_plays")).toHaveLength(1);
      expect(await getSignalEvents(userId, "plex_album_tracks")).toHaveLength(
        1
      );
      expect(await getSignalEvents(userId, "plex_listen_history")).toHaveLength(
        1
      );
    }
  });

  it("skips users without a token and disabled users", async () => {
    await createUser("local", null);
    await createUser("disabled", "tok-d", 0);

    await runSignalIngestionOnce();

    expect(mockGetRatedItems).not.toHaveBeenCalled();
  });

  it("does nothing when the backup is disabled", async () => {
    mockGetConfigValue.mockReturnValue({ ratingsBackupEnabled: false });
    await createUser("alice", "tok-a");

    await runSignalIngestionOnce();

    expect(mockGetRatedItems).not.toHaveBeenCalled();
    expect(await getSignalEvents(1, "plex_track_plays")).toHaveLength(0);
  });

  it("does not write a second plays capture within the interval", async () => {
    await createUser("alice", "tok-a");

    await runSignalIngestionOnce();
    await runSignalIngestionOnce();

    expect(await getSignalEvents(1, "plex_track_plays")).toHaveLength(1);
  });

  it("does not walk the catalogue again within the weekly interval", async () => {
    await createUser("alice", "tok-a");

    await runSignalIngestionOnce();
    await runSignalIngestionOnce(Date.now() + 2 * 24 * 60 * 60 * 1000);

    expect(await getSignalEvents(1, "plex_album_tracks")).toHaveLength(1);
    expect(mockGetAllAlbumTrackCounts).toHaveBeenCalledTimes(1);
  });

  it("walks the catalogue again once the interval has passed", async () => {
    await createUser("alice", "tok-a");

    await runSignalIngestionOnce();
    mockGetAllAlbumTrackCounts.mockResolvedValue([
      {
        ratingKey: "alb1",
        title: "Prologue",
        artistKey: "art1",
        artistName: "Andromedik",
        trackCount: 12,
      },
    ]);
    await runSignalIngestionOnce(Date.now() + 8 * 24 * 60 * 60 * 1000);

    expect(await getSignalEvents(1, "plex_album_tracks")).toHaveLength(2);
  });

  it("sweeps history every tick, appending only plays it has not seen", async () => {
    await createUser("alice", "tok-a");

    await runSignalIngestionOnce();
    await runSignalIngestionOnce();

    expect(mockGetPlayHistory).toHaveBeenCalledTimes(2);
    expect(await getSignalEvents(1, "plex_listen_history")).toHaveLength(1);
  });

  it("captures plays before history, so an episode finds its track length", async () => {
    await createUser("alice", "tok-a");

    await runSignalIngestionOnce();

    const events = await getSignalEvents(1, "plex_listen_history");
    const [episode] = JSON.parse(events[0].payload).episodes;
    expect(episode.durationMs).toBe(210_000);
  });

  it("isolates per-user failures so the sweep continues", async () => {
    await createUser("broken", "tok-x");
    await createUser("alice", "tok-a");
    mockGetRatedItems.mockRejectedValueOnce(new Error("plex down"));

    await runSignalIngestionOnce();

    expect(await getSignalEvents(1, "plex_track_plays")).toHaveLength(0);
    expect(await getSignalEvents(2, "plex_track_plays")).toHaveLength(1);
  });
});
