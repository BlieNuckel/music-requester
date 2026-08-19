import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./User";

/**
 * The `kind` discriminator for an append-only raw signal. The set grows over time
 * (plays, ratings, behaviour) without a migration — a new signal is a new string.
 */
export type SignalKind =
  | "plex_plays"
  | "plex_track_plays"
  | "plex_listen_history"
  | "plex_rating"
  | "request"
  | "skip";

/** Authoritative, append-only raw signals — plays, ratings, behaviour all land here. */
@Entity("user_signal_events")
export class UserSignalEvent {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index("idx_user_signal_events_user_id")
  @Column({ type: "integer" })
  user_id!: number;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Index("idx_user_signal_events_kind")
  @Column({ type: "text" })
  kind!: string;

  @Column({ type: "text" })
  payload!: string;

  @Column({ type: "text" })
  recorded_at!: string;
}
