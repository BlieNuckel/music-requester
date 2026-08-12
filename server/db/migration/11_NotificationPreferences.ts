import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Sparse per-user notification opt-ins. Rows exist only where a user deviates
 * from an event's default, so the table stays empty for untouched accounts.
 */
export class NotificationPreferences1719000000000 implements MigrationInterface {
  name = "NotificationPreferences1719000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "notification_preferences" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        "user_id" INTEGER NOT NULL,
        "event_id" TEXT NOT NULL,
        "transport_id" TEXT NOT NULL,
        "enabled" BOOLEAN NOT NULL,
        "updated_at" TEXT NOT NULL,
        CONSTRAINT "fk_notification_pref_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )`
    );

    await queryRunner.query(
      `CREATE INDEX "idx_notification_pref_user_id"
       ON "notification_preferences"("user_id")`
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_notification_pref_user_event_transport"
       ON "notification_preferences"("user_id", "event_id", "transport_id")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_notification_pref_user_event_transport"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_notification_pref_user_id"`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_preferences"`);
  }
}
