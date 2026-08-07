import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Renames seen_releases to followed_releases and replaces the provider-locked
 * source/external_id pair with a provider-agnostic release_group_mbid, plus
 * columns for cover art, release types, and per-entry viewed tracking.
 * The users.followed_last_viewed_at watermark is folded into viewed_at.
 */
export class FollowedReleases1718000000000 implements MigrationInterface {
  name = "FollowedReleases1718000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "seen_releases" RENAME TO "followed_releases"`
    );

    await queryRunner.query(
      `ALTER TABLE "followed_releases" ADD COLUMN "release_group_mbid" TEXT`
    );
    await queryRunner.query(
      `ALTER TABLE "followed_releases" ADD COLUMN "cover_url" TEXT`
    );
    await queryRunner.query(
      `ALTER TABLE "followed_releases" ADD COLUMN "release_type" TEXT`
    );
    await queryRunner.query(
      `ALTER TABLE "followed_releases" ADD COLUMN "secondary_types" TEXT`
    );
    await queryRunner.query(
      `ALTER TABLE "followed_releases" ADD COLUMN "viewed_at" TEXT`
    );

    await queryRunner.query(
      `UPDATE "followed_releases"
       SET "release_group_mbid" = "external_id"
       WHERE "source" = 'musicbrainz' AND "external_id" IS NOT NULL`
    );
    await queryRunner.query(
      `UPDATE "followed_releases"
       SET "cover_url" = 'https://coverartarchive.org/release-group/' || "release_group_mbid" || '/front-500'
       WHERE "release_group_mbid" IS NOT NULL`
    );

    await queryRunner.query(
      `UPDATE "followed_releases"
       SET "viewed_at" = (
         SELECT u."followed_last_viewed_at"
         FROM "followed_artists" fa
         JOIN "users" u ON u."id" = fa."user_id"
         WHERE fa."id" = "followed_releases"."followed_artist_id"
       )
       WHERE "notified_at" <= (
         SELECT u."followed_last_viewed_at"
         FROM "followed_artists" fa
         JOIN "users" u ON u."id" = fa."user_id"
         WHERE fa."id" = "followed_releases"."followed_artist_id"
       )`
    );

    await queryRunner.query(
      `ALTER TABLE "followed_releases" DROP COLUMN "source"`
    );
    await queryRunner.query(
      `ALTER TABLE "followed_releases" DROP COLUMN "external_id"`
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_seen_followed_artist_id"`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_followed_release_artist_id" ON "followed_releases"("followed_artist_id")`
    );

    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "followed_last_viewed_at"`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "followed_last_viewed_at" TEXT`
    );

    await queryRunner.query(
      `ALTER TABLE "followed_releases" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'musicbrainz'`
    );
    await queryRunner.query(
      `ALTER TABLE "followed_releases" ADD COLUMN "external_id" TEXT`
    );
    await queryRunner.query(
      `UPDATE "followed_releases" SET "external_id" = "release_group_mbid"`
    );

    await queryRunner.query(
      `ALTER TABLE "followed_releases" DROP COLUMN "release_group_mbid"`
    );
    await queryRunner.query(
      `ALTER TABLE "followed_releases" DROP COLUMN "cover_url"`
    );
    await queryRunner.query(
      `ALTER TABLE "followed_releases" DROP COLUMN "release_type"`
    );
    await queryRunner.query(
      `ALTER TABLE "followed_releases" DROP COLUMN "secondary_types"`
    );
    await queryRunner.query(
      `ALTER TABLE "followed_releases" DROP COLUMN "viewed_at"`
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_followed_release_artist_id"`
    );
    await queryRunner.query(
      `ALTER TABLE "followed_releases" RENAME TO "seen_releases"`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_seen_followed_artist_id" ON "seen_releases"("followed_artist_id")`
    );
  }
}
