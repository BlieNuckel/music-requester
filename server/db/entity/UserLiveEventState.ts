import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from "typeorm";
import { User } from "./User";
import { LiveEvent } from "./LiveEvent";

/** `going` suppresses both banner windows; `dismissed` suppresses permanently. */
export type LiveEventResponse = "going" | "dismissed";

/**
 * Sparse per-user state over shared events. A missing row means "no response,
 * never notified, never seen", so nothing needs backfilling when an event is
 * swept in. Written only on interaction.
 */
@Entity("user_live_event_state")
@Unique("uq_user_live_event_state", ["user_id", "event_id"])
export class UserLiveEventState {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index("idx_user_live_event_state_user_id")
  @Column({ type: "integer" })
  user_id!: number;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Column({ type: "integer" })
  event_id!: number;

  @ManyToOne(() => LiveEvent, { onDelete: "CASCADE" })
  @JoinColumn({ name: "event_id" })
  event!: LiveEvent;

  @Column({ type: "text", nullable: true })
  response!: LiveEventResponse | null;

  @Column({ type: "text", nullable: true })
  responded_at!: string | null;

  @Column({ type: "text", nullable: true })
  viewed_at!: string | null;

  @Column({ type: "text", nullable: true })
  notified_at!: string | null;
}
