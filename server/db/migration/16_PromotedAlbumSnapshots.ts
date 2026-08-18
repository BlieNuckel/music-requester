import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Persists the last good spotlight carousel per user. Rebuilding one costs up to 30
 * paced MusicBrainz lookups, so losing the in-memory cache on every restart made the
 * first Discover load of a session pay for it — and fail outright whenever one of
 * those lookups came back 503.
 */
export class PromotedAlbumSnapshots1724000000000 implements MigrationInterface {
  name = "PromotedAlbumSnapshots1724000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "promoted_album_snapshots" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "albums_json" TEXT NOT NULL,
        "target_count" INTEGER NOT NULL,
        "built_at" TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_promoted_album_snapshots_user_id" ON "promoted_album_snapshots"("user_id")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "promoted_album_snapshots"`);
  }
}
