import { Entity, PrimaryGeneratedColumn, Column, Index, Unique } from "typeorm";

export type LiveEventStatus =
  "scheduled" | "rescheduled" | "postponed" | "cancelled";

export type LiveEventDeletionStatus = "deleted" | "trashed" | "merged";

/**
 * One row per event, shared across users. Keyed by `event_key`, which prefers
 * the canonical `jambase:N` identifier over a source-specific one so the same
 * show arriving from two ticketing sources does not land twice.
 */
@Entity("live_events")
@Unique("uq_live_events_event_key", ["event_key"])
export class LiveEvent {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "text" })
  event_key!: string;

  @Column({ type: "text" })
  name!: string;

  @Index("idx_live_events_event_date")
  @Column({ type: "text" })
  event_date!: string;

  /** Populated on a reschedule, so the UI can say what the date moved from. */
  @Column({ type: "text", nullable: true })
  previous_start_date!: string | null;

  @Column({ type: "text", default: "scheduled" })
  event_status!: LiveEventStatus;

  @Column({ type: "text", nullable: true })
  status_changed_at!: string | null;

  @Column({ type: "text", nullable: true })
  venue_name!: string | null;

  @Column({ type: "text", nullable: true })
  venue_city!: string | null;

  /** ISO 3166-1 alpha-2. Note GB, not UK, matching `geoCountryIso2`. */
  @Index("idx_live_events_venue_country")
  @Column({ type: "text", nullable: true })
  venue_country!: string | null;

  @Column({ type: "real", nullable: true })
  venue_lat!: number | null;

  @Column({ type: "real", nullable: true })
  venue_lon!: number | null;

  @Column({ type: "text", nullable: true })
  ticket_url!: string | null;

  @Column({ type: "text", nullable: true })
  image_url!: string | null;

  /** Drives the announce window: when we first told anyone about this. */
  @Column({ type: "text" })
  first_seen_at!: string;

  @Column({ type: "text" })
  last_seen_at!: string;

  /** Set when a completed sweep stopped seeing an event it fully enumerated. */
  @Column({ type: "text", nullable: true })
  disappeared_at!: string | null;

  @Column({ type: "text", nullable: true })
  deletion_status!: LiveEventDeletionStatus | null;

  /** `event_key` this row was merged into, for `deletion_status = "merged"`. */
  @Column({ type: "text", nullable: true })
  merged_into!: string | null;
}
