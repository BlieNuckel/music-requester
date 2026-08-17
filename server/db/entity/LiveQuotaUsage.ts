import { Entity, PrimaryGeneratedColumn, Column, Unique } from "typeorm";

/**
 * One row per billing period. A counter in the config row would mean rewriting
 * that JSON on every API call, which is why this is a table.
 *
 * `warned_thresholds` persists which alerts have already fired so a restart
 * cannot make the instance shout about the same threshold twice.
 */
@Entity("live_quota_usage")
@Unique("uq_live_quota_usage_period", ["period"])
export class LiveQuotaUsage {
  @PrimaryGeneratedColumn()
  id!: number;

  /** Billing period key, `YYYY-MM` anchored on the subscription start day. */
  @Column({ type: "text" })
  period!: string;

  @Column({ type: "integer", default: 0 })
  calls!: number;

  /** JSON-encoded number[] of ratio thresholds already announced this period. */
  @Column({ type: "text", nullable: true })
  warned_thresholds!: string | null;

  @Column({ type: "text" })
  updated_at!: string;
}
