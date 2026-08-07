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
}
