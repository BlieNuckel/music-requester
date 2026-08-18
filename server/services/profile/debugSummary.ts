import { getConfigValue } from "../../config";
import {
  computeConfigHash,
  getSignalEvents,
  listUserProfiles,
  parseDerivedProfile,
} from "../../db/userProfile";
import { DERIVED_PROFILE_SCHEMA_VERSION } from "../../db/entity/UserProfile";
import { getAllUsers } from "../../auth/users";
import {
  latestRatings,
  reconstructTrackPlayCounts,
  rollupToArtists,
} from "./signalIngestion";
import type { UserProfile } from "../../db/entity/UserProfile";
import type { UserSignalEvent } from "../../db/entity/UserSignalEvent";

/** Sizes of the derived document, which is what "is it building" comes down to. */
export type ProfileDebugCounts = {
  genres: number;
  artists: number;
  similarSeeds: number;
  similarCandidates: number;
  knownAlbums: number;
  exploredAlbums: number;
  exploredArtists: number;
};

export type ProfileDebugProfile = {
  generatedAt: string;
  lastUsedAt: string;
  schemaVersion: number;
  currentSchemaVersion: number;
  configHash: string;
  currentConfigHash: string;
  /** True when the next request will regenerate rather than serve this row. */
  stale: boolean;
  counts: ProfileDebugCounts;
  topGenres: { tag: string; weight: number }[];
  topArtists: { name: string; viewCount: number }[];
};

/** One signal kind's extent in the append-only log. */
export type ProfileDebugSignal = {
  kind: string;
  count: number;
  firstAt: string;
  lastAt: string;
};

/** A recent write, so "is ingestion running" is answerable at a glance. */
export type ProfileDebugRecentSignal = {
  kind: string;
  recordedAt: string;
  /** How many items the delta carried, which is what makes a no-op visible. */
  changed: number;
};

/** Current folded state of what Plex has told us, not a live Plex query. */
export type ProfileDebugPlex = {
  trackedTracks: number;
  totalPlays: number;
  artists: number;
  ratedItems: number;
};

export type ProfileDebugEntry = {
  userId: number;
  username: string;
  hasPlexToken: boolean;
  profile: ProfileDebugProfile | null;
  signals: ProfileDebugSignal[];
  recentSignals: ProfileDebugRecentSignal[];
  plex: ProfileDebugPlex;
};

const TOP_LIST_SIZE = 10;

const RECENT_SIGNAL_COUNT = 8;

/** Payload shapes only differ in which array carries the delta. */
const DELTA_ARRAYS = ["tracks", "artists"] as const;

function countDelta(event: UserSignalEvent): number {
  try {
    const payload = JSON.parse(event.payload) as Record<string, unknown>;
    for (const field of DELTA_ARRAYS) {
      const value = payload[field];
      if (Array.isArray(value)) return value.length;
    }
    return 1;
  } catch {
    return 0;
  }
}

function summarizeSignals(events: UserSignalEvent[]): ProfileDebugSignal[] {
  const byKind = new Map<string, ProfileDebugSignal>();

  // Events come back oldest-first, so first seen is first and last wins.
  for (const event of events) {
    const existing = byKind.get(event.kind);
    if (existing) {
      existing.count += 1;
      existing.lastAt = event.recorded_at;
      continue;
    }
    byKind.set(event.kind, {
      kind: event.kind,
      count: 1,
      firstAt: event.recorded_at,
      lastAt: event.recorded_at,
    });
  }

  return [...byKind.values()].sort((a, b) => a.kind.localeCompare(b.kind));
}

function recentSignals(events: UserSignalEvent[]): ProfileDebugRecentSignal[] {
  return events
    .slice(-RECENT_SIGNAL_COUNT)
    .reverse()
    .map((event) => ({
      kind: event.kind,
      recordedAt: event.recorded_at,
      changed: countDelta(event),
    }));
}

function foldPlexState(events: UserSignalEvent[]): ProfileDebugPlex {
  const tracks = reconstructTrackPlayCounts(events, Infinity);
  const artists = rollupToArtists(tracks);

  return {
    trackedTracks: tracks.size,
    totalPlays: artists.reduce((sum, artist) => sum + artist.playCount, 0),
    artists: artists.length,
    ratedItems: latestRatings(events).size,
  };
}

function summarizeProfile(
  row: UserProfile,
  currentConfigHash: string
): ProfileDebugProfile {
  const profile = parseDerivedProfile(row.profile_json);

  return {
    generatedAt: row.generated_at,
    lastUsedAt: row.last_used_at,
    schemaVersion: row.schema_version,
    currentSchemaVersion: DERIVED_PROFILE_SCHEMA_VERSION,
    configHash: row.config_hash,
    currentConfigHash,
    stale:
      row.config_hash !== currentConfigHash ||
      row.schema_version !== DERIVED_PROFILE_SCHEMA_VERSION ||
      profile.genreVector.length === 0,
    counts: {
      genres: profile.genreVector.length,
      artists: profile.artistTags.length,
      similarSeeds: profile.similarGraph.length,
      similarCandidates: profile.similarGraph.reduce(
        (sum, seed) => sum + seed.candidates.length,
        0
      ),
      knownAlbums: profile.knownAlbums.length,
      exploredAlbums: profile.explorationHistory.albums.length,
      exploredArtists: profile.explorationHistory.artists.length,
    },
    topGenres: profile.genreVector
      .slice(0, TOP_LIST_SIZE)
      .map(({ tag, weight }) => ({ tag, weight })),
    topArtists: [...profile.artistTags]
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, TOP_LIST_SIZE)
      .map(({ name, viewCount }) => ({ name, viewCount })),
  };
}

/**
 * Everything stored about every user's taste, for an admin to check that the
 * pollers are doing something. Reads only our own tables: the point is to see
 * what we have, not what Plex currently says.
 */
export async function getProfileDebugSummaries(): Promise<ProfileDebugEntry[]> {
  const currentConfigHash = computeConfigHash(getConfigValue("promotedAlbum"));
  const [users, profiles] = await Promise.all([
    getAllUsers(),
    listUserProfiles(),
  ]);
  const byUser = new Map(profiles.map((row) => [row.user_id, row]));

  return Promise.all(
    users.map(async (user) => {
      const events = await getSignalEvents(user.id);
      const row = byUser.get(user.id);

      return {
        userId: user.id,
        username: user.username,
        hasPlexToken: user.hasPlexToken,
        profile: row ? summarizeProfile(row, currentConfigHash) : null,
        signals: summarizeSignals(events),
        recentSignals: recentSignals(events),
        plex: foldPlexState(events),
      };
    })
  );
}
