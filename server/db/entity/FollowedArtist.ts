import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from "typeorm";
import { User } from "./User";

@Entity("followed_artists")
@Unique("uq_followed_user_artist", ["user_id", "artist_mbid"])
export class FollowedArtist {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index("idx_followed_user_id")
  @Column({ type: "integer" })
  user_id!: number;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Index("idx_followed_artist_mbid")
  @Column({ type: "text" })
  artist_mbid!: string;

  @Column({ type: "text" })
  artist_name!: string;

  @Column({ type: "text", nullable: true })
  last_checked_at!: string | null;

  /**
   * The artist's JamBase identifier (`jambase:219057`), resolved once from the
   * MBID. `jambase_resolved_at` set with a null id records a confirmed miss, so
   * an artist JamBase has never heard of is not re-resolved on every sweep.
   */
  @Index("idx_followed_jambase_artist_id")
  @Column({ type: "text", nullable: true })
  jambase_artist_id!: string | null;

  @Column({ type: "text", nullable: true })
  jambase_resolved_at!: string | null;

  @CreateDateColumn({ type: "text" })
  created_at!: string;
}
