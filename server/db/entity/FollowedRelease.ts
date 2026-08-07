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
import { FollowedArtist } from "./FollowedArtist";

@Entity("followed_releases")
@Unique("uq_followed_release", ["followed_artist_id", "release_key"])
export class FollowedRelease {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index("idx_followed_release_artist_id")
  @Column({ type: "integer" })
  followed_artist_id!: number;

  @ManyToOne(() => FollowedArtist, { onDelete: "CASCADE" })
  @JoinColumn({ name: "followed_artist_id" })
  followed_artist!: FollowedArtist;

  @Column({ type: "text" })
  release_key!: string;

  @Column({ type: "text" })
  album_title!: string;

  @Column({ type: "text", nullable: true })
  release_date!: string | null;

  @Column({ type: "text", nullable: true })
  release_group_mbid!: string | null;

  @Column({ type: "text", nullable: true })
  cover_url!: string | null;

  @Column({ type: "text", nullable: true })
  release_type!: string | null;

  /** JSON-encoded string[] of MusicBrainz secondary types. */
  @Column({ type: "text", nullable: true })
  secondary_types!: string | null;

  @Column({ type: "text", nullable: true })
  viewed_at!: string | null;

  @CreateDateColumn({ type: "text" })
  notified_at!: string;
}
