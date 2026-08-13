import { createHash } from "crypto";
import { getDataSource } from "./index";
import {
  UserProfile,
  DERIVED_PROFILE_SCHEMA_VERSION,
  type DerivedProfile,
} from "./entity/UserProfile";
import { UserSignalEvent } from "./entity/UserSignalEvent";

/** The config fields that shape the derived profile and thus invalidate it on change. */
export type ProfileConfigInputs = {
  topArtistsRange: string;
  genericTags: string[];
  tagsPerArtist: number;
  pickedArtistsCount: number;
  playTrendWindowDays: number;
  ratingWeight: number;
  distributionWeight: number;
  minPlaysForDistribution: number;
  topArtistsCount: number;
  exploreCandidateCount: number;
};

/** A partial patch of the anti-repeat exploration memory; only provided fields are replaced. */
export type ExplorationHistoryPatch = {
  albums?: string[];
  artists?: string[];
};

const EMPTY_DERIVED_PROFILE: DerivedProfile = {
  genreVector: [],
  artistTags: [],
  similarGraph: [],
  explorationHistory: { albums: [], artists: [] },
};

/** Far-past timestamp so a profile row created only to hold exploration memory reads as stale. */
const STALE_GENERATED_AT = "1970-01-01T00:00:00.000Z";

export function serializeDerivedProfile(profile: DerivedProfile): string {
  return JSON.stringify(profile);
}

/**
 * Parse a stored `profile_json`. Returns an empty profile when the stored shape is
 * unreadable so callers never crash on a corrupt/legacy row — a regenerate replaces it.
 */
export function parseDerivedProfile(json: string): DerivedProfile {
  try {
    const parsed = JSON.parse(json) as Partial<DerivedProfile>;
    return {
      genreVector: parsed.genreVector ?? [],
      artistTags: parsed.artistTags ?? [],
      similarGraph: parsed.similarGraph ?? [],
      explorationHistory: {
        albums: parsed.explorationHistory?.albums ?? [],
        artists: parsed.explorationHistory?.artists ?? [],
      },
    };
  } catch {
    return { ...EMPTY_DERIVED_PROFILE };
  }
}

/** Stable hash of the config inputs that shape the vector — a mismatch forces a regenerate. */
export function computeConfigHash(inputs: ProfileConfigInputs): string {
  const stable = JSON.stringify({
    topArtistsRange: inputs.topArtistsRange,
    genericTags: [...inputs.genericTags].map((t) => t.toLowerCase()).sort(),
    tagsPerArtist: inputs.tagsPerArtist,
    pickedArtistsCount: inputs.pickedArtistsCount,
    playTrendWindowDays: inputs.playTrendWindowDays,
    ratingWeight: inputs.ratingWeight,
    distributionWeight: inputs.distributionWeight,
    minPlaysForDistribution: inputs.minPlaysForDistribution,
    topArtistsCount: inputs.topArtistsCount,
    exploreCandidateCount: inputs.exploreCandidateCount,
  });
  return createHash("sha256").update(stable).digest("hex");
}

export async function getUserProfile(
  userId: number
): Promise<UserProfile | null> {
  const repo = getDataSource().getRepository(UserProfile);
  return repo.findOne({ where: { user_id: userId } });
}

/**
 * Insert or replace the derived profile for a user. Stamps `generated_at` and
 * `last_used_at` to now and writes the current {@link DERIVED_PROFILE_SCHEMA_VERSION}.
 */
export async function upsertUserProfile(
  userId: number,
  profile: DerivedProfile,
  configHash: string
): Promise<UserProfile> {
  const repo = getDataSource().getRepository(UserProfile);
  const now = new Date().toISOString();
  const existing = await repo.findOne({ where: { user_id: userId } });

  const entity = repo.create({
    ...(existing ?? {}),
    user_id: userId,
    profile_json: serializeDerivedProfile(profile),
    schema_version: DERIVED_PROFILE_SCHEMA_VERSION,
    config_hash: configHash,
    generated_at: now,
    last_used_at: now,
  });

  return repo.save(entity);
}

export async function touchProfileUsed(userId: number): Promise<void> {
  const repo = getDataSource().getRepository(UserProfile);
  await repo.update(
    { user_id: userId },
    { last_used_at: new Date().toISOString() }
  );
}

/**
 * Merge a patch into the persisted exploration (anti-repeat) memory without touching
 * the derived vector or its provenance. When no profile row exists yet, a placeholder
 * row is created stamped stale so the next recommendation regenerates the vector.
 */
export async function updateExplorationHistory(
  userId: number,
  patch: ExplorationHistoryPatch
): Promise<void> {
  const repo = getDataSource().getRepository(UserProfile);
  const existing = await repo.findOne({ where: { user_id: userId } });

  if (existing) {
    const profile = parseDerivedProfile(existing.profile_json);
    const next: DerivedProfile = {
      ...profile,
      explorationHistory: {
        albums: patch.albums ?? profile.explorationHistory.albums,
        artists: patch.artists ?? profile.explorationHistory.artists,
      },
    };
    await repo.update(
      { user_id: userId },
      { profile_json: serializeDerivedProfile(next) }
    );
    return;
  }

  const placeholder: DerivedProfile = {
    ...EMPTY_DERIVED_PROFILE,
    explorationHistory: {
      albums: patch.albums ?? [],
      artists: patch.artists ?? [],
    },
  };
  const entity = repo.create({
    user_id: userId,
    profile_json: serializeDerivedProfile(placeholder),
    schema_version: DERIVED_PROFILE_SCHEMA_VERSION,
    config_hash: "",
    generated_at: STALE_GENERATED_AT,
    last_used_at: new Date().toISOString(),
  });
  await repo.save(entity);
}

export async function appendSignalEvent(
  userId: number,
  kind: string,
  payload: unknown
): Promise<UserSignalEvent> {
  const repo = getDataSource().getRepository(UserSignalEvent);
  const entity = repo.create({
    user_id: userId,
    kind,
    payload: JSON.stringify(payload),
    recorded_at: new Date().toISOString(),
  });
  return repo.save(entity);
}

/** A persisted profile paired with its owner's Plex token, for background regeneration. */
export type ProfileRegenCandidate = {
  userId: number;
  plexToken: string;
  profile: UserProfile;
};

/**
 * Every persisted profile owned by an enabled user with a stored Plex token. The
 * background regenerator filters these by staleness + activity; users who never
 * used discovery have no row and are intentionally absent (no quota spent on them).
 */
export async function getProfileRegenCandidates(): Promise<
  ProfileRegenCandidate[]
> {
  const rows = (await getDataSource().query(
    `SELECT p.id, p.user_id, p.profile_json, p.schema_version, p.config_hash,
            p.generated_at, p.last_used_at, u.plex_token AS plex_token
     FROM user_profiles p
     JOIN users u ON u.id = p.user_id
     WHERE u.plex_token IS NOT NULL AND u.enabled = 1`
  )) as (UserProfile & { plex_token: string })[];

  return rows.map((row) => ({
    userId: row.user_id,
    plexToken: row.plex_token,
    profile: row,
  }));
}

/** A user eligible for signal ingestion: enabled and holding a Plex token. */
export type SignalIngestionUser = {
  userId: number;
  plexToken: string;
};

/**
 * Every enabled user with a stored Plex token — the daily signal-ingestion sweep
 * runs for all of them, not just users who have a derived profile. Home servers
 * have few users, so a full sweep is cheap.
 */
export async function getSignalIngestionUsers(): Promise<
  SignalIngestionUser[]
> {
  const rows = (await getDataSource().query(
    `SELECT id AS user_id, plex_token
     FROM users
     WHERE plex_token IS NOT NULL AND enabled = 1`
  )) as { user_id: number; plex_token: string }[];

  return rows.map((row) => ({
    userId: row.user_id,
    plexToken: row.plex_token,
  }));
}

export async function getSignalEvents(
  userId: number,
  kind?: string
): Promise<UserSignalEvent[]> {
  const repo = getDataSource().getRepository(UserSignalEvent);
  return repo.find({
    where: kind ? { user_id: userId, kind } : { user_id: userId },
    order: { recorded_at: "ASC", id: "ASC" },
  });
}
