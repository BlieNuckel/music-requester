import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./User";

/**
 * One browser push subscription, i.e. one device. A user can hold several, and
 * the endpoint is the push service's own unique handle for it — re-subscribing
 * the same device returns the same endpoint, so it doubles as the upsert key.
 */
@Entity("push_subscriptions")
export class PushSubscription {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index("idx_push_subscriptions_user_id")
  @Column({ type: "integer" })
  user_id!: number;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Index("idx_push_subscriptions_endpoint", { unique: true })
  @Column({ type: "text" })
  endpoint!: string;

  @Column({ type: "text" })
  p256dh!: string;

  @Column({ type: "text" })
  auth!: string;

  @Column({ type: "text", nullable: true })
  user_agent!: string | null;

  @CreateDateColumn({ type: "text" })
  created_at!: string;

  @Column({ type: "text" })
  last_seen_at!: string;
}
