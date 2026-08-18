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
 * The last carousel a user was successfully served, as one JSON document per user.
 *
 * The in-memory result cache it mirrors dies with the process, so every restart used to
 * make the next Discover load rebuild from scratch — five picks, up to 30 paced
 * MusicBrainz lookups, against a service that answers 503 often enough to matter. This
 * row is what a cold start and a failed rebuild both fall back to.
 *
 * `albums_json` holds `PromotedAlbumEntry[]`. Its shape is not versioned: an unreadable
 * or outdated document is simply ignored, and the next successful build replaces it.
 */
@Entity("promoted_album_snapshots")
export class PromotedAlbumSnapshot {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index("idx_promoted_album_snapshots_user_id", { unique: true })
  @Column({ type: "integer" })
  user_id!: number;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Column({ type: "text" })
  albums_json!: string;

  /** How many picks the build that produced this document was aiming for. */
  @Column({ type: "integer" })
  target_count!: number;

  @Column({ type: "text" })
  built_at!: string;
}
