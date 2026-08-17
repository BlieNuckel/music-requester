import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";
import { Permission } from "../../../shared/permissions";

export type UserType = "local" | "plex";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "text", nullable: true, unique: true })
  username!: string | null;

  @Column({ type: "text", nullable: true })
  password_hash!: string | null;

  @Index("idx_users_plex_id")
  @Column({ type: "text", nullable: true, unique: true })
  plex_id!: string | null;

  @Column({ type: "text", nullable: true })
  plex_email!: string | null;

  @Column({ type: "text", nullable: true })
  plex_thumb!: string | null;

  @Column({ type: "integer", default: Permission.REQUEST })
  permissions!: number;

  @Column({ type: "integer", default: 1 })
  enabled!: number;

  @CreateDateColumn({ type: "text" })
  created_at!: string;

  @UpdateDateColumn({ type: "text" })
  updated_at!: string;

  @Column({ type: "text", default: "system" })
  theme!: "light" | "dark" | "system";

  @Column({ type: "text", nullable: true })
  plex_username!: string | null;

  @Column({ type: "text", nullable: true })
  plex_token!: string | null;

  @Column({ type: "text", default: "local" })
  user_type!: UserType;

  /**
   * Live-events preferences. All nullable, and NULL means "inherit the
   * server-wide value" rather than "off", so a user who never opens the
   * settings page follows the instance defaults. Filters only: none of these
   * widen what the shared sweeps fetch.
   */
  @Column({ type: "integer", nullable: true })
  live_radius_km!: number | null;

  @Column({ type: "real", nullable: true })
  live_lat!: number | null;

  @Column({ type: "real", nullable: true })
  live_lon!: number | null;

  /** JSON-encoded ISO 3166-1 alpha-2 array. GB, not UK. */
  @Column({ type: "text", nullable: true })
  live_regions!: string | null;

  @Column({ type: "integer", nullable: true })
  live_announce_days!: number | null;

  @Column({ type: "integer", nullable: true })
  live_imminent_days_local!: number | null;

  @Column({ type: "integer", nullable: true })
  live_imminent_days_regional!: number | null;

  @Column({ type: "boolean", nullable: true })
  live_banner_enabled!: boolean | null;
}
