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
 * The derived, regenerable profile document persisted as `profile_json`.
 * Adding a field here is migration-free: bump {@link DERIVED_PROFILE_SCHEMA_VERSION}
 * and a version mismatch marks the stored row stale so it regenerates.
 */
export type SimilarGraphCandidate = {
  name: string;
  artistMbid: string;
  score: number;
  genres: string[];
};

/**
 * One seed artist and the genre-tagged similar artists explore mode draws from.
 * Built at regeneration time so explore no longer fans out to Plex/MusicBrainz/
 * ListenBrainz/Last.fm per request. `genres` are already filtered by generic tags;
 * the genre-overlap threshold is applied at request time off these stored sets.
 */
export type SimilarGraphSeed = {
  seedArtist: string;
  seedMbid: string;
  seedGenres: string[];
  viewCount: number;
  candidates: SimilarGraphCandidate[];
};

export type DerivedProfile = {
  genreVector: { tag: string; weight: number; fromArtists: string[] }[];
  artistTags: {
    name: string;
    viewCount: number;
    tags: { name: string; count: number }[];
    distinctTracksPlayed?: number;
    topTrackShare?: number;
    distributionFactor?: number;
    ratingBreadth?: number;
    ratingMultiplier?: number;
    availableTracks?: number;
  }[];
  similarGraph: SimilarGraphSeed[];
  explorationHistory: { albums: string[]; artists: string[] };
};

export const DERIVED_PROFILE_SCHEMA_VERSION = 6;

/** Derived, regenerable cache — one row per user, the whole profile as one document. */
@Entity("user_profiles")
export class UserProfile {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index("idx_user_profiles_user_id", { unique: true })
  @Column({ type: "integer" })
  user_id!: number;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Column({ type: "text" })
  profile_json!: string;

  @Column({ type: "integer" })
  schema_version!: number;

  @Column({ type: "text" })
  config_hash!: string;

  @Column({ type: "text" })
  generated_at!: string;

  @Column({ type: "text" })
  last_used_at!: string;
}
