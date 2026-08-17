import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from "typeorm";
import { LiveEvent } from "./LiveEvent";

/**
 * The lineup of an event, and the join that makes the whole feature work:
 * `artist_jambase_id` against `followed_artists.jambase_artist_id`.
 *
 * The key is the JamBase artist id rather than an MBID because
 * `expandExternalIdentifiers` is plan-gated, so performer nodes carry
 * `identifier` but never a MusicBrainz id.
 */
@Entity("live_event_performers")
@Unique("uq_live_event_performer", ["event_id", "artist_jambase_id"])
export class LiveEventPerformer {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index("idx_live_event_performers_event_id")
  @Column({ type: "integer" })
  event_id!: number;

  @ManyToOne(() => LiveEvent, { onDelete: "CASCADE" })
  @JoinColumn({ name: "event_id" })
  event!: LiveEvent;

  @Index("idx_live_event_performers_artist")
  @Column({ type: "text" })
  artist_jambase_id!: string;

  @Column({ type: "text" })
  artist_name!: string;

  @Column({ type: "boolean", default: false })
  is_headliner!: boolean;

  @Column({ type: "integer", nullable: true })
  performance_rank!: number | null;

  /** JSON-encoded genre slugs from JamBase, used to score shelf affinity. */
  @Column({ type: "text", nullable: true })
  genres!: string | null;
}
