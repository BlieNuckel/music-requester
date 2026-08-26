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

/**
 * One artist's listening over time as stored on the profile — the derived shape, not the
 * raw episodes. Buckets are dense and chronological; see `artistSeries.ts` for how they are
 * reconciled between the episode log and the cumulative counts.
 */
export type ProfileArtistSeries = {
  name: string;
  bucketMs: number;
  /** Left edge of the first bucket, so a bucket's time is index * bucketMs from here. */
  startMs: number;
  plays: number[];
  listenedMs: number[];
  firstSeenMs: number | null;
  momentum: number;
  emerging: boolean;
  decaying: boolean;
};

/**
 * Where an album's genres were resolved from, in the order they are tried. `artist` means
 * the album had none of its own and inherited its artist's tags — the pre-album behaviour,
 * kept as the fallback because Plex agent genres are frequently one coarse word or missing
 * entirely, and the Last.fm artist tags are what give the vector its texture.
 */
export type AlbumTagSource = "lastfm-album" | "plex-album" | "artist";

/**
 * A tag that is not a genre, kept rather than discarded. `region` and `era` are recognised
 * classes and candidates for their own input vectors later; `unknown` is what neither
 * vocabulary claimed. None of them carry weight into {@link DerivedProfile.genreVector} —
 * a recommender that draws `nigerian` and asks Last.fm for albums tagged with it is
 * recommending by nationality while believing it recommends by genre.
 */
export type ClassifiedOtherTag = {
  name: string;
  canonical: string;
  class: "region" | "era" | "unknown";
};

/**
 * One album's genres and the weight they carry into {@link DerivedProfile.genreVector}.
 *
 * `weight` is the album's *share of its artist's weight*, not an independent measure:
 * `artistWeight × (album play-equivalents / artist play-equivalents)`. An artist therefore
 * still contributes exactly its play weight to the vector, now divided across its records
 * by how much each was actually listened to — so an acoustic record pulls only its own
 * share into the wrong tag instead of the artist's whole catalogue.
 *
 * An artist whose listening lands on no album at all gets one entry with an empty `albumKey`
 * holding its whole weight.
 */
export type ProfileAlbumTags = {
  albumKey: string;
  title: string;
  artistName: string;
  weight: number;
  source: AlbumTagSource;
  /** Genres only, under their canonical names. This is what the vector is summed from. */
  tags: { name: string; count: number }[];
  /** What the album was also tagged with, gathered across every source tried. */
  otherTags: ClassifiedOtherTag[];
};

export type DerivedProfile = {
  genreVector: { tag: string; weight: number; fromArtists: string[] }[];
  artistTags: {
    name: string;
    viewCount: number;
    tags: { name: string; count: number }[];
    ratingMultiplier?: number;
  }[];
  similarGraph: SimilarGraphSeed[];
  /**
   * The genre-bearing unit. `artistTags` still carries what Last.fm says about each artist
   * (and the weighting evidence behind `viewCount`), but the vector is summed from here.
   */
  albumTags: ProfileAlbumTags[];
  /**
   * Listening over time for the artists worth keeping it for. Stored parallel-array rather
   * than per-bucket objects: at 26 buckets an object per bucket triples the document for
   * nothing, and both consumers read it as two series anyway.
   */
  artistSeries: ProfileArtistSeries[];
  /** Normalized `artist::album` keys the user already listens to — see `knownAlbums.ts`. */
  knownAlbums: string[];
  explorationHistory: { albums: string[]; artists: string[] };
};

export const DERIVED_PROFILE_SCHEMA_VERSION = 10;

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
