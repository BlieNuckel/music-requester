import { describe, it, expect, afterEach } from "vitest";
import { createDataSource } from "./dataSource";
import { RenamePlexPlays1717000000000 } from "./migration/9_RenamePlexPlays";
import { FollowedReleases1718000000000 } from "./migration/10_FollowedReleases";
import { LiveEvents1721000000000 } from "./migration/13_LiveEvents";
import type { DataSource } from "typeorm";

let ds: DataSource | null = null;

afterEach(async () => {
  if (ds?.isInitialized) {
    await ds.destroy();
  }
  ds = null;
});

async function initTestDb(): Promise<DataSource> {
  ds = createDataSource(":memory:");
  await ds.initialize();
  await ds.query("PRAGMA foreign_keys = ON");
  return ds;
}

describe("InitialSchema migration", () => {
  it("creates users table with correct columns", async () => {
    const db = await initTestDb();

    const columns = (await db.query("PRAGMA table_info(users)")) as {
      name: string;
    }[];
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toEqual([
      "id",
      "username",
      "password_hash",
      "plex_id",
      "plex_email",
      "plex_thumb",
      "permissions",
      "enabled",
      "created_at",
      "updated_at",
      "theme",
      "plex_username",
      "plex_token",
      "user_type",
      "live_radius_km",
      "live_lat",
      "live_lon",
      "live_regions",
      "live_announce_days",
      "live_imminent_days_local",
      "live_imminent_days_regional",
      "live_banner_enabled",
    ]);
  });

  it("creates sessions table with correct columns", async () => {
    const db = await initTestDb();

    const columns = (await db.query("PRAGMA table_info(sessions)")) as {
      name: string;
    }[];
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toEqual([
      "id",
      "token",
      "user_id",
      "expires_at",
      "created_at",
    ]);
  });

  it("creates expected indexes", async () => {
    const db = await initTestDb();

    const indexes = (await db.query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
    )) as { name: string }[];
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain("idx_sessions_token");
    expect(indexNames).toContain("idx_sessions_user_id");
    expect(indexNames).toContain("idx_sessions_expires_at");
    expect(indexNames).toContain("idx_users_plex_id");
  });
});

describe("RequestLidarrStatus migration", () => {
  it("adds nullable lidarr_status column to requests", async () => {
    const db = await initTestDb();

    const columns = (await db.query("PRAGMA table_info(requests)")) as {
      name: string;
      notnull: number;
    }[];
    const lidarrStatus = columns.find((c) => c.name === "lidarr_status");

    expect(lidarrStatus).toBeDefined();
    expect(lidarrStatus?.notnull).toBe(0);
  });

  it("creates the lidarr_status index", async () => {
    const db = await initTestDb();

    const indexes = (await db.query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_requests_lidarr_status'"
    )) as { name: string }[];

    expect(indexes.map((i) => i.name)).toContain("idx_requests_lidarr_status");
  });
});

describe("constraint enforcement", () => {
  it("enforces enabled CHECK constraint", async () => {
    const db = await initTestDb();

    await expect(
      db.query("INSERT INTO users (username, enabled) VALUES (?, ?)", [
        "test",
        2,
      ])
    ).rejects.toThrow();
  });

  it("enforces username UNIQUE constraint", async () => {
    const db = await initTestDb();

    await db.query("INSERT INTO users (username) VALUES (?)", ["alice"]);

    await expect(
      db.query("INSERT INTO users (username) VALUES (?)", ["alice"])
    ).rejects.toThrow();
  });

  it("enforces foreign key on sessions.user_id", async () => {
    const db = await initTestDb();

    await expect(
      db.query(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
        ["tok123", 999, "2099-01-01 00:00:00"]
      )
    ).rejects.toThrow();
  });

  it("cascades session deletion when user is deleted", async () => {
    const db = await initTestDb();

    await db.query("INSERT INTO users (username) VALUES (?)", ["alice"]);
    const users = await db.query("SELECT id FROM users WHERE username = ?", [
      "alice",
    ]);
    const userId = users[0].id;

    await db.query(
      "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
      ["tok123", userId, "2099-01-01 00:00:00"]
    );

    await db.query("DELETE FROM users WHERE id = ?", [userId]);

    const sessions = await db.query(
      "SELECT * FROM sessions WHERE user_id = ?",
      [userId]
    );
    expect(sessions).toHaveLength(0);
  });

  it("applies default values for permissions, enabled, and timestamps", async () => {
    const db = await initTestDb();

    await db.query("INSERT INTO users (username) VALUES (?)", ["bob"]);
    const users = await db.query("SELECT * FROM users WHERE username = ?", [
      "bob",
    ]);
    const user = users[0];

    expect(user.permissions).toBe(8);
    expect(user.enabled).toBe(1);
    expect(user.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(user.updated_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe("FollowedArtists migration", () => {
  it("creates followed_artists and followed_releases tables", async () => {
    const db = await initTestDb();

    const followedCols = (await db.query(
      "PRAGMA table_info(followed_artists)"
    )) as { name: string }[];
    expect(followedCols.map((c) => c.name)).toEqual([
      "id",
      "user_id",
      "artist_mbid",
      "artist_name",
      "last_checked_at",
      "created_at",
      "jambase_artist_id",
      "jambase_resolved_at",
    ]);

    const releaseCols = (await db.query(
      "PRAGMA table_info(followed_releases)"
    )) as { name: string }[];
    expect(releaseCols.map((c) => c.name)).toEqual([
      "id",
      "followed_artist_id",
      "release_key",
      "album_title",
      "release_date",
      "notified_at",
      "release_group_mbid",
      "cover_url",
      "release_type",
      "secondary_types",
      "viewed_at",
    ]);
  });

  it("enforces unique (user_id, artist_mbid)", async () => {
    const db = await initTestDb();
    await db.query("INSERT INTO users (username) VALUES (?)", ["alice"]);
    const [{ id: userId }] = (await db.query(
      "SELECT id FROM users WHERE username = ?",
      ["alice"]
    )) as { id: number }[];

    await db.query(
      "INSERT INTO followed_artists (user_id, artist_mbid, artist_name) VALUES (?, ?, ?)",
      [userId, "mbid-1", "Artist"]
    );

    await expect(
      db.query(
        "INSERT INTO followed_artists (user_id, artist_mbid, artist_name) VALUES (?, ?, ?)",
        [userId, "mbid-1", "Artist"]
      )
    ).rejects.toThrow();
  });

  it("cascades followed_releases when followed_artist is deleted", async () => {
    const db = await initTestDb();
    await db.query("INSERT INTO users (username) VALUES (?)", ["bob"]);
    const [{ id: userId }] = (await db.query(
      "SELECT id FROM users WHERE username = ?",
      ["bob"]
    )) as { id: number }[];

    await db.query(
      "INSERT INTO followed_artists (user_id, artist_mbid, artist_name) VALUES (?, ?, ?)",
      [userId, "mbid-1", "Artist"]
    );
    const [{ id: followedId }] = (await db.query(
      "SELECT id FROM followed_artists WHERE artist_mbid = ?",
      ["mbid-1"]
    )) as { id: number }[];

    await db.query(
      "INSERT INTO followed_releases (followed_artist_id, release_key, album_title) VALUES (?, ?, ?)",
      [followedId, "key-1", "Album"]
    );

    await db.query("DELETE FROM followed_artists WHERE id = ?", [followedId]);

    const rows = (await db.query(
      "SELECT * FROM followed_releases WHERE followed_artist_id = ?",
      [followedId]
    )) as unknown[];
    expect(rows).toHaveLength(0);
  });

  it("FollowedReleases migration backfills MBIDs and viewed_at from legacy rows", async () => {
    const db = await initTestDb();

    const runner = db.createQueryRunner();
    const migration = new FollowedReleases1718000000000();
    await migration.down(runner);

    await db.query("INSERT INTO users (username) VALUES (?)", ["erin"]);
    const [{ id: userId }] = (await db.query(
      "SELECT id FROM users WHERE username = ?",
      ["erin"]
    )) as { id: number }[];
    await db.query(
      "UPDATE users SET followed_last_viewed_at = ? WHERE id = ?",
      ["2025-06-01T00:00:00.000Z", userId]
    );

    await db.query(
      "INSERT INTO followed_artists (user_id, artist_mbid, artist_name) VALUES (?, ?, ?)",
      [userId, "mbid-1", "Artist"]
    );
    const [{ id: followedId }] = (await db.query(
      "SELECT id FROM followed_artists WHERE artist_mbid = ?",
      ["mbid-1"]
    )) as { id: number }[];

    await db.query(
      `INSERT INTO seen_releases
         (followed_artist_id, release_key, source, album_title, external_id, notified_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        followedId,
        "old-mb|2025-04",
        "musicbrainz",
        "Old MB",
        "rg-old",
        "2025-05-01T00:00:00.000Z",
      ]
    );
    await db.query(
      `INSERT INTO seen_releases
         (followed_artist_id, release_key, source, album_title, external_id, notified_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        followedId,
        "new-dz|2025-06",
        "deezer",
        "New Deezer",
        "12345",
        "2025-07-01T00:00:00.000Z",
      ]
    );

    await migration.up(runner);
    await runner.release();

    const rows = (await db.query(
      "SELECT * FROM followed_releases ORDER BY id"
    )) as {
      album_title: string;
      release_group_mbid: string | null;
      cover_url: string | null;
      viewed_at: string | null;
    }[];

    const oldMb = rows.find((r) => r.album_title === "Old MB")!;
    expect(oldMb.release_group_mbid).toBe("rg-old");
    expect(oldMb.cover_url).toBe(
      "https://coverartarchive.org/release-group/rg-old/front-500"
    );
    expect(oldMb.viewed_at).toBe("2025-06-01T00:00:00.000Z");

    const newDz = rows.find((r) => r.album_title === "New Deezer")!;
    expect(newDz.release_group_mbid).toBeNull();
    expect(newDz.cover_url).toBeNull();
    expect(newDz.viewed_at).toBeNull();

    const userCols = (await db.query("PRAGMA table_info(users)")) as {
      name: string;
    }[];
    expect(userCols.map((c) => c.name)).not.toContain(
      "followed_last_viewed_at"
    );
  });

  it("cascades followed_artists when user is deleted", async () => {
    const db = await initTestDb();
    await db.query("INSERT INTO users (username) VALUES (?)", ["carol"]);
    const [{ id: userId }] = (await db.query(
      "SELECT id FROM users WHERE username = ?",
      ["carol"]
    )) as { id: number }[];

    await db.query(
      "INSERT INTO followed_artists (user_id, artist_mbid, artist_name) VALUES (?, ?, ?)",
      [userId, "mbid-2", "Artist 2"]
    );

    await db.query("DELETE FROM users WHERE id = ?", [userId]);

    const rows = (await db.query(
      "SELECT * FROM followed_artists WHERE user_id = ?",
      [userId]
    )) as unknown[];
    expect(rows).toHaveLength(0);
  });
});

describe("UserProfile migration", () => {
  it("creates user_profiles and user_signal_events tables", async () => {
    const db = await initTestDb();

    const profileCols = (await db.query(
      "PRAGMA table_info(user_profiles)"
    )) as { name: string }[];
    expect(profileCols.map((c) => c.name)).toEqual([
      "id",
      "user_id",
      "profile_json",
      "schema_version",
      "config_hash",
      "generated_at",
      "last_used_at",
    ]);

    const eventCols = (await db.query(
      "PRAGMA table_info(user_signal_events)"
    )) as { name: string }[];
    expect(eventCols.map((c) => c.name)).toEqual([
      "id",
      "user_id",
      "kind",
      "payload",
      "recorded_at",
    ]);
  });

  it("creates the expected indexes", async () => {
    const db = await initTestDb();

    const indexes = (await db.query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_user_%' ORDER BY name"
    )) as { name: string }[];
    const names = indexes.map((i) => i.name);

    expect(names).toContain("idx_user_profiles_user_id");
    expect(names).toContain("idx_user_signal_events_user_id");
    expect(names).toContain("idx_user_signal_events_kind");
  });

  it("enforces unique user_id on user_profiles", async () => {
    const db = await initTestDb();
    await db.query("INSERT INTO users (username) VALUES (?)", ["alice"]);
    const [{ id: userId }] = (await db.query(
      "SELECT id FROM users WHERE username = ?",
      ["alice"]
    )) as { id: number }[];

    await db.query(
      "INSERT INTO user_profiles (user_id, profile_json, schema_version, config_hash) VALUES (?, ?, ?, ?)",
      [userId, "{}", 1, "hash"]
    );

    await expect(
      db.query(
        "INSERT INTO user_profiles (user_id, profile_json, schema_version, config_hash) VALUES (?, ?, ?, ?)",
        [userId, "{}", 1, "hash"]
      )
    ).rejects.toThrow();
  });

  it("queries signal events by kind and user_id", async () => {
    const db = await initTestDb();
    await db.query("INSERT INTO users (username) VALUES (?)", ["bob"]);
    const [{ id: userId }] = (await db.query(
      "SELECT id FROM users WHERE username = ?",
      ["bob"]
    )) as { id: number }[];

    await db.query(
      "INSERT INTO user_signal_events (user_id, kind, payload) VALUES (?, ?, ?)",
      [userId, "plex_plays", "{}"]
    );
    await db.query(
      "INSERT INTO user_signal_events (user_id, kind, payload) VALUES (?, ?, ?)",
      [userId, "plex_rating", "{}"]
    );

    const plays = (await db.query(
      "SELECT * FROM user_signal_events WHERE user_id = ? AND kind = ?",
      [userId, "plex_plays"]
    )) as unknown[];
    expect(plays).toHaveLength(1);

    const all = (await db.query(
      "SELECT * FROM user_signal_events WHERE user_id = ?",
      [userId]
    )) as unknown[];
    expect(all).toHaveLength(2);
  });

  it("RenamePlexPlays migration relabels legacy 'snapshot' rows as 'plex_plays'", async () => {
    const db = await initTestDb();
    await db.query("INSERT INTO users (username) VALUES (?)", ["dave"]);
    const [{ id: userId }] = (await db.query(
      "SELECT id FROM users WHERE username = ?",
      ["dave"]
    )) as { id: number }[];

    await db.query(
      "INSERT INTO user_signal_events (user_id, kind, payload) VALUES (?, ?, ?)",
      [userId, "snapshot", "{}"]
    );
    await db.query(
      "INSERT INTO user_signal_events (user_id, kind, payload) VALUES (?, ?, ?)",
      [userId, "plex_rating", "{}"]
    );

    const runner = db.createQueryRunner();
    await new RenamePlexPlays1717000000000().up(runner);
    await runner.release();

    const kinds = (
      (await db.query(
        "SELECT kind FROM user_signal_events WHERE user_id = ? ORDER BY id",
        [userId]
      )) as { kind: string }[]
    ).map((r) => r.kind);
    expect(kinds).toEqual(["plex_plays", "plex_rating"]);
  });

  it("cascades user_profiles and user_signal_events when user is deleted", async () => {
    const db = await initTestDb();
    await db.query("INSERT INTO users (username) VALUES (?)", ["carol"]);
    const [{ id: userId }] = (await db.query(
      "SELECT id FROM users WHERE username = ?",
      ["carol"]
    )) as { id: number }[];

    await db.query(
      "INSERT INTO user_profiles (user_id, profile_json, schema_version, config_hash) VALUES (?, ?, ?, ?)",
      [userId, "{}", 1, "hash"]
    );
    await db.query(
      "INSERT INTO user_signal_events (user_id, kind, payload) VALUES (?, ?, ?)",
      [userId, "plex_plays", "{}"]
    );

    await db.query("DELETE FROM users WHERE id = ?", [userId]);

    const profiles = (await db.query(
      "SELECT * FROM user_profiles WHERE user_id = ?",
      [userId]
    )) as unknown[];
    const events = (await db.query(
      "SELECT * FROM user_signal_events WHERE user_id = ?",
      [userId]
    )) as unknown[];
    expect(profiles).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("enforces foreign key on user_profiles.user_id", async () => {
    const db = await initTestDb();
    await expect(
      db.query(
        "INSERT INTO user_profiles (user_id, profile_json, schema_version, config_hash) VALUES (?, ?, ?, ?)",
        [999, "{}", 1, "hash"]
      )
    ).rejects.toThrow();
  });
});

describe("LiveEvents migration", () => {
  it("creates live_events, performers, and per-user state", async () => {
    const db = await initTestDb();

    const eventCols = (await db.query("PRAGMA table_info(live_events)")) as {
      name: string;
    }[];
    expect(eventCols.map((c) => c.name)).toEqual([
      "id",
      "event_key",
      "name",
      "event_date",
      "previous_start_date",
      "event_status",
      "status_changed_at",
      "venue_name",
      "venue_city",
      "venue_country",
      "venue_lat",
      "venue_lon",
      "ticket_url",
      "image_url",
      "first_seen_at",
      "last_seen_at",
      "disappeared_at",
      "deletion_status",
      "merged_into",
    ]);

    const performerCols = (await db.query(
      "PRAGMA table_info(live_event_performers)"
    )) as { name: string }[];
    expect(performerCols.map((c) => c.name)).toEqual([
      "id",
      "event_id",
      "artist_jambase_id",
      "artist_name",
      "is_headliner",
      "performance_rank",
      "genres",
    ]);

    const stateCols = (await db.query(
      "PRAGMA table_info(user_live_event_state)"
    )) as { name: string }[];
    expect(stateCols.map((c) => c.name)).toEqual([
      "id",
      "user_id",
      "event_id",
      "response",
      "responded_at",
      "viewed_at",
      "notified_at",
    ]);
  });

  it("rejects a duplicate event_key", async () => {
    const db = await initTestDb();
    const insert = `INSERT INTO live_events
      (event_key, name, event_date, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)`;
    const args = ["jambase:1", "Show", "2026-09-01", "now", "now"];

    await db.query(insert, args);
    await expect(db.query(insert, args)).rejects.toThrow();
  });

  it("enforces foreign keys on performers and per-user state", async () => {
    const db = await initTestDb();

    await expect(
      db.query(
        "INSERT INTO live_event_performers (event_id, artist_jambase_id, artist_name) VALUES (?, ?, ?)",
        [999, "jambase:1", "Artist"]
      )
    ).rejects.toThrow();

    await expect(
      db.query(
        "INSERT INTO user_live_event_state (user_id, event_id) VALUES (?, ?)",
        [999, 999]
      )
    ).rejects.toThrow();
  });

  it("reverts cleanly, dropping the tables and added columns", async () => {
    const db = await initTestDb();

    const runner = db.createQueryRunner();
    await new LiveEvents1721000000000().down(runner);

    const tables = (await db.query(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
       ('live_events', 'live_event_performers', 'user_live_event_state')`
    )) as { name: string }[];
    expect(tables).toEqual([]);

    const followedCols = (await db.query(
      "PRAGMA table_info(followed_artists)"
    )) as { name: string }[];
    expect(followedCols.map((c) => c.name)).not.toContain("jambase_artist_id");

    const userCols = (await db.query("PRAGMA table_info(users)")) as {
      name: string;
    }[];
    expect(userCols.map((c) => c.name)).not.toContain("live_regions");
  });
});
