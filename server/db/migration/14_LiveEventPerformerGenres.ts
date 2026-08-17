import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Genre slugs come free on every performer node, and they are the only affinity
 * signal available without name-matching JamBase artists against the taste
 * profile. The nearby shelf ranks and floors on them.
 */
export class LiveEventPerformerGenres1722000000000 implements MigrationInterface {
  name = "LiveEventPerformerGenres1722000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "live_event_performers" ADD COLUMN "genres" TEXT`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "live_event_performers" DROP COLUMN "genres"`
    );
  }
}
