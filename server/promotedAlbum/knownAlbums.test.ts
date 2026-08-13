import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadKnownAlbums } from "./knownAlbums";
import { initializeDatabase, closeDatabase, getDataSource } from "../db";
import { appendSignalEvent } from "../db/userProfile";

type TrackSpec = {
  ratingKey: string;
  artistName: string;
  albumKey: string;
  albumTitle: string;
  playCount: number;
};

async function appendTracks(userId: number, tracks: TrackSpec[]) {
  await appendSignalEvent(userId, "plex_track_plays", {
    tracks: tracks.map((t) => ({
      ratingKey: t.ratingKey,
      title: `t${t.ratingKey}`,
      artistKey: `ak-${t.artistName}`,
      artistName: t.artistName,
      albumKey: t.albumKey,
      albumTitle: t.albumTitle,
      playCount: t.playCount,
    })),
  });
}

describe("loadKnownAlbums", () => {
  beforeEach(async () => {
    await initializeDatabase(":memory:");
    await getDataSource().query("INSERT INTO users (username) VALUES (?)", [
      "alice",
    ]);
  });
  afterEach(async () => {
    await closeDatabase();
  });

  it("returns nothing when the user has no plays", async () => {
    expect(await loadKnownAlbums(1)).toEqual([]);
  });

  it("keys albums the user has listened through, most played first", async () => {
    await appendTracks(1, [
      {
        ratingKey: "1",
        artistName: "Slowdive",
        albumKey: "alb-1",
        albumTitle: "Souvlaki",
        playCount: 4,
      },
      {
        ratingKey: "2",
        artistName: "Slowdive",
        albumKey: "alb-1",
        albumTitle: "Souvlaki",
        playCount: 4,
      },
      {
        ratingKey: "3",
        artistName: "Ride",
        albumKey: "alb-2",
        albumTitle: "Nowhere",
        playCount: 20,
      },
    ]);

    expect(await loadKnownAlbums(1)).toEqual([
      "ride::nowhere",
      "slowdive::souvlaki",
    ]);
  });

  it("ignores an album with only a stray play or two", async () => {
    await appendTracks(1, [
      {
        ratingKey: "1",
        artistName: "Slowdive",
        albumKey: "alb-1",
        albumTitle: "Souvlaki",
        playCount: 2,
      },
    ]);

    expect(await loadKnownAlbums(1)).toEqual([]);
  });

  it("accumulates plays across the delta series", async () => {
    await appendTracks(1, [
      {
        ratingKey: "1",
        artistName: "Slowdive",
        albumKey: "alb-1",
        albumTitle: "Souvlaki",
        playCount: 2,
      },
    ]);
    await appendTracks(1, [
      {
        ratingKey: "1",
        artistName: "Slowdive",
        albumKey: "alb-1",
        albumTitle: "Souvlaki",
        playCount: 9,
      },
    ]);

    expect(await loadKnownAlbums(1)).toEqual(["slowdive::souvlaki"]);
  });
});
