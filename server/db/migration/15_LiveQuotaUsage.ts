import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * JamBase does not expose remaining monthly quota in any response header, and
 * it bills rather than refuses once the plan's allowance is gone, so usage has
 * to be counted locally to be visible at all.
 */
export class LiveQuotaUsage1723000000000 implements MigrationInterface {
  name = "LiveQuotaUsage1723000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "live_quota_usage" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        "period" TEXT NOT NULL,
        "calls" INTEGER NOT NULL DEFAULT (0),
        "warned_thresholds" TEXT,
        "updated_at" TEXT NOT NULL
      )`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_live_quota_usage_period"
       ON "live_quota_usage"("period")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_live_quota_usage_period"`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "live_quota_usage"`);
  }
}
