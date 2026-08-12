import type { MigrationInterface, QueryRunner } from "typeorm";

/** One row per subscribed device, keyed by the push service's endpoint. */
export class PushSubscriptions1720000000000 implements MigrationInterface {
  name = "PushSubscriptions1720000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "push_subscriptions" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        "user_id" INTEGER NOT NULL,
        "endpoint" TEXT NOT NULL,
        "p256dh" TEXT NOT NULL,
        "auth" TEXT NOT NULL,
        "user_agent" TEXT,
        "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
        "last_seen_at" TEXT NOT NULL,
        CONSTRAINT "fk_push_subscriptions_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )`
    );

    await queryRunner.query(
      `CREATE INDEX "idx_push_subscriptions_user_id"
       ON "push_subscriptions"("user_id")`
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_push_subscriptions_endpoint"
       ON "push_subscriptions"("endpoint")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_push_subscriptions_endpoint"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_push_subscriptions_user_id"`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "push_subscriptions"`);
  }
}
