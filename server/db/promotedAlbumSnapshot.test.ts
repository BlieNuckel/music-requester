import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initializeDatabase, getDataSource, closeDatabase } from "./index";
import {
  getPromotedAlbumSnapshot,
  savePromotedAlbumSnapshot,
} from "./promotedAlbumSnapshot";
import type { PromotedAlbumEntry } from "../promotedAlbum/types";

const BUILT_AT = Date.parse("2026-08-17T21:00:00.000Z");

function entry(mbid: string): PromotedAlbumEntry {
  return {
    mode: "within_taste",
    album: {
      name: `Album ${mbid}`,
      mbid,
      artistName: "Slowdive",
      artistMbid: "mbid-slowdive",
      coverUrl: `https://coverartarchive.org/release-group/${mbid}/front-500`,
      year: "1993",
    },
    tag: "shoegaze",
    inLibrary: false,
    library: null,
    trace: {
      source: "candidateWalk",
      nodes: [],
      budget: { label: "MusicBrainz lookups per build", remaining: 29, of: 30 },
    },
  };
}

async function createUser(username: string): Promise<number> {
  await getDataSource().query("INSERT INTO users (username) VALUES (?)", [
    username,
  ]);
  const [{ id }] = (await getDataSource().query(
    "SELECT id FROM users WHERE username = ?",
    [username]
  )) as { id: number }[];
  return id;
}

beforeEach(async () => {
  await initializeDatabase(":memory:");
});

afterEach(async () => {
  await closeDatabase();
});

describe("promoted album snapshots", () => {
  it("returns null for a user with no stored carousel", async () => {
    const userId = await createUser("alice");
    expect(await getPromotedAlbumSnapshot(userId)).toBeNull();
  });

  it("stores a carousel and reads it back", async () => {
    const userId = await createUser("alice");

    await savePromotedAlbumSnapshot(userId, [entry("rg-1")], 5, BUILT_AT);

    expect(await getPromotedAlbumSnapshot(userId)).toEqual({
      albums: [entry("rg-1")],
      targetCount: 5,
      builtAt: BUILT_AT,
    });
  });

  it("replaces the stored carousel rather than accumulating rows", async () => {
    const userId = await createUser("alice");

    await savePromotedAlbumSnapshot(userId, [entry("rg-1")], 5, BUILT_AT);
    await savePromotedAlbumSnapshot(
      userId,
      [entry("rg-2")],
      3,
      BUILT_AT + 60_000
    );

    const stored = await getPromotedAlbumSnapshot(userId);
    expect(stored?.albums.map((a) => a.album.mbid)).toEqual(["rg-2"]);
    expect(stored?.targetCount).toBe(3);

    const rows = (await getDataSource().query(
      "SELECT COUNT(*) AS count FROM promoted_album_snapshots"
    )) as { count: number }[];
    expect(rows[0].count).toBe(1);
  });

  it("keeps carousels separate per user", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");

    await savePromotedAlbumSnapshot(alice, [entry("rg-1")], 5, BUILT_AT);

    expect(await getPromotedAlbumSnapshot(bob)).toBeNull();
  });

  it("does not store an empty carousel", async () => {
    const userId = await createUser("alice");

    await savePromotedAlbumSnapshot(userId, [], 5, BUILT_AT);

    expect(await getPromotedAlbumSnapshot(userId)).toBeNull();
  });

  it("reports an unreadable document as absent", async () => {
    const userId = await createUser("alice");
    await savePromotedAlbumSnapshot(userId, [entry("rg-1")], 5, BUILT_AT);
    await getDataSource().query(
      "UPDATE promoted_album_snapshots SET albums_json = 'not json' WHERE user_id = ?",
      [userId]
    );

    expect(await getPromotedAlbumSnapshot(userId)).toBeNull();
  });

  it("reports a document that is not an album list as absent", async () => {
    const userId = await createUser("alice");
    await savePromotedAlbumSnapshot(userId, [entry("rg-1")], 5, BUILT_AT);
    await getDataSource().query(
      `UPDATE promoted_album_snapshots SET albums_json = '{"albums":[]}' WHERE user_id = ?`,
      [userId]
    );

    expect(await getPromotedAlbumSnapshot(userId)).toBeNull();
  });

  it("goes away with its user", async () => {
    const userId = await createUser("alice");
    await savePromotedAlbumSnapshot(userId, [entry("rg-1")], 5, BUILT_AT);

    await getDataSource().query("DELETE FROM users WHERE id = ?", [userId]);

    const rows = (await getDataSource().query(
      "SELECT COUNT(*) AS count FROM promoted_album_snapshots"
    )) as { count: number }[];
    expect(rows[0].count).toBe(0);
  });
});
