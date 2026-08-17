import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Live events: shared event rows, their lineups, and sparse per-user state.
 *
 * Events are keyed by `event_key` rather than hung off a followed artist,
 * because an event has a lineup that several followed artists can appear on and
 * the sweeps are per-location rather than per-user. Lineups join on the JamBase
 * artist id, since `expandExternalIdentifiers` is plan-gated and performer nodes
 * never carry MusicBrainz ids.
 */
export class LiveEvents1721000000000 implements MigrationInterface {
  name = "LiveEvents1721000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "live_events" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        "event_key" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "event_date" TEXT NOT NULL,
        "previous_start_date" TEXT,
        "event_status" TEXT NOT NULL DEFAULT 'scheduled',
        "status_changed_at" TEXT,
        "venue_name" TEXT,
        "venue_city" TEXT,
        "venue_country" TEXT,
        "venue_lat" REAL,
        "venue_lon" REAL,
        "ticket_url" TEXT,
        "image_url" TEXT,
        "first_seen_at" TEXT NOT NULL,
        "last_seen_at" TEXT NOT NULL,
        "disappeared_at" TEXT,
        "deletion_status" TEXT,
        "merged_into" TEXT
      )`
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_live_events_event_key"
       ON "live_events"("event_key")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_live_events_event_date" ON "live_events"("event_date")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_live_events_venue_country"
       ON "live_events"("venue_country")`
    );

    await queryRunner.query(
      `CREATE TABLE "live_event_performers" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        "event_id" INTEGER NOT NULL,
        "artist_jambase_id" TEXT NOT NULL,
        "artist_name" TEXT NOT NULL,
        "is_headliner" BOOLEAN NOT NULL DEFAULT (0),
        "performance_rank" INTEGER,
        CONSTRAINT "fk_live_event_performers_event" FOREIGN KEY ("event_id")
          REFERENCES "live_events" ("id") ON DELETE CASCADE
      )`
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_live_event_performer"
       ON "live_event_performers"("event_id", "artist_jambase_id")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_live_event_performers_event_id"
       ON "live_event_performers"("event_id")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_live_event_performers_artist"
       ON "live_event_performers"("artist_jambase_id")`
    );

    await queryRunner.query(
      `CREATE TABLE "user_live_event_state" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        "user_id" INTEGER NOT NULL,
        "event_id" INTEGER NOT NULL,
        "response" TEXT,
        "responded_at" TEXT,
        "viewed_at" TEXT,
        "notified_at" TEXT,
        CONSTRAINT "fk_user_live_event_state_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_user_live_event_state_event" FOREIGN KEY ("event_id")
          REFERENCES "live_events" ("id") ON DELETE CASCADE
      )`
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_user_live_event_state"
       ON "user_live_event_state"("user_id", "event_id")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_user_live_event_state_user_id"
       ON "user_live_event_state"("user_id")`
    );

    await queryRunner.query(
      `ALTER TABLE "followed_artists" ADD COLUMN "jambase_artist_id" TEXT`
    );
    await queryRunner.query(
      `ALTER TABLE "followed_artists" ADD COLUMN "jambase_resolved_at" TEXT`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_followed_jambase_artist_id"
       ON "followed_artists"("jambase_artist_id")`
    );

    for (const column of [
      `"live_radius_km" INTEGER`,
      `"live_lat" REAL`,
      `"live_lon" REAL`,
      `"live_regions" TEXT`,
      `"live_announce_days" INTEGER`,
      `"live_imminent_days_local" INTEGER`,
      `"live_imminent_days_regional" INTEGER`,
      `"live_banner_enabled" BOOLEAN`,
    ]) {
      await queryRunner.query(`ALTER TABLE "users" ADD COLUMN ${column}`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of [
      "live_banner_enabled",
      "live_imminent_days_regional",
      "live_imminent_days_local",
      "live_announce_days",
      "live_regions",
      "live_lon",
      "live_lat",
      "live_radius_km",
    ]) {
      await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "${column}"`);
    }

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_followed_jambase_artist_id"`
    );
    await queryRunner.query(
      `ALTER TABLE "followed_artists" DROP COLUMN "jambase_resolved_at"`
    );
    await queryRunner.query(
      `ALTER TABLE "followed_artists" DROP COLUMN "jambase_artist_id"`
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_user_live_event_state_user_id"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_user_live_event_state"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_live_event_state"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_live_event_performers_artist"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_live_event_performers_event_id"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_live_event_performer"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "live_event_performers"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_live_events_venue_country"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_live_events_event_date"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_live_events_event_key"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "live_events"`);
  }
}
