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

/**
 * Sparse per-user opt-in overrides. A missing row means "use the event's
 * `defaultEnabled`", so adding an event to the catalog needs no backfill and a
 * user who never opens the settings page still gets sensible delivery.
 */
@Entity("notification_preferences")
@Unique("uq_notification_pref_user_event_transport", [
  "user_id",
  "event_id",
  "transport_id",
])
export class NotificationPreference {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index("idx_notification_pref_user_id")
  @Column({ type: "integer" })
  user_id!: number;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Column({ type: "text" })
  event_id!: string;

  @Column({ type: "text" })
  transport_id!: string;

  @Column({ type: "boolean" })
  enabled!: boolean;

  @Column({ type: "text" })
  updated_at!: string;
}
