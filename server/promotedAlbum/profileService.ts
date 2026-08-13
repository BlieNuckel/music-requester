import { loadArtistWeights, type ArtistWeight } from "./artistWeights";
import { buildSimilarGraph } from "./explore";
import { getArtistTopTags } from "../api/lastfm/artists";
import { getConfigValue } from "../config";
import type { PromotedAlbumConfig } from "../config";
import { weightedRandomPick } from "../utils/random";
import { AsyncLock } from "../api/asyncLock";
import {
  getUserProfile,
  upsertUserProfile,
  touchProfileUsed,
  computeConfigHash,
  parseDerivedProfile,
} from "../db/userProfile";
import type { UserProfile, DerivedProfile } from "../db/entity/UserProfile";
import { DERIVED_PROFILE_SCHEMA_VERSION } from "../db/entity/UserProfile";

type TagResultEntry = {
  artist: ArtistWeight;
  tags: { name: string; count: number }[];
};

type TagAccumulator = {
  displayName: string;
  weight: number;
  fromArtists: Set<string>;
};

/**
 * Per-user lock so a live request and a background regeneration can't both rebuild
 * the same profile and race the upsert. Keyed by user id.
 */
const profileLock = new AsyncLock();

/**
 * An artist's tag weights, normalized so the artist contributes exactly its play weight to
 * the genre vector. Last.fm scales `artist.getTopTags` counts 0–100 *within* an artist, so
 * without this an artist tagged 100/90/80 carries several times the tag mass of one tagged
 * 100/20/10 at an identical play weight — influence tracking how Last.fm happened to tag
 * them rather than how much the user plays them. An all-zero tag mass splits the weight
 * evenly instead of dropping the artist out of the vector.
 */
export function normalizedTagWeights(
  tags: { count: number }[],
  viewCount: number
): number[] {
  if (tags.length === 0) return [];
  const counts = tags.map((t) => Math.max(0, t.count));
  const mass = counts.reduce((sum, count) => sum + count, 0);
  if (mass <= 0) return counts.map(() => viewCount / tags.length);
  return counts.map((count) => (count / mass) * viewCount);
}

function buildProfileArtifacts(
  tagResults: TagResultEntry[],
  genericTags: Set<string>,
  tagsPerArtist: number
): Pick<DerivedProfile, "genreVector" | "artistTags"> {
  const artistTags: DerivedProfile["artistTags"] = tagResults.map(
    ({ artist, tags }) => ({
      name: artist.name,
      viewCount: artist.viewCount,
      tags: tags
        .filter((t) => !genericTags.has(t.name.toLowerCase()))
        .slice(0, tagsPerArtist),
      distinctTracksPlayed: artist.distinctTracksPlayed,
      topTrackShare: artist.topTrackShare,
      distributionFactor: artist.distributionFactor,
    })
  );

  const tagMap = new Map<string, TagAccumulator>();
  for (const { name, viewCount, tags } of artistTags) {
    const weights = normalizedTagWeights(tags, viewCount);
    for (const [index, tag] of tags.entries()) {
      const key = tag.name.toLowerCase();
      const weight = weights[index];
      const existing = tagMap.get(key);
      if (existing) {
        existing.weight += weight;
        existing.fromArtists.add(name);
      } else {
        tagMap.set(key, {
          displayName: tag.name,
          weight,
          fromArtists: new Set([name]),
        });
      }
    }
  }

  const genreVector: DerivedProfile["genreVector"] = Array.from(
    tagMap.values()
  ).map((v) => ({
    tag: v.displayName,
    weight: v.weight,
    fromArtists: Array.from(v.fromArtists),
  }));

  return { genreVector, artistTags };
}

async function fetchTagResults(
  pickedArtists: ArtistWeight[]
): Promise<TagResultEntry[]> {
  return Promise.all(
    pickedArtists.map(async (artist) => {
      try {
        return { artist, tags: await getArtistTopTags(artist.name) };
      } catch {
        return { artist, tags: [] };
      }
    })
  );
}

/**
 * Rebuild a user's derived profile from Plex top-artists + Last.fm tags and persist it.
 * Request-free (token in, profile out) so the Phase 3 scheduler can call it directly.
 * Returns null when the user has no top artists or every tag is generic; the existing
 * row (if any) is left untouched in that case. Existing exploration memory is carried
 * forward across the regenerate.
 */
export async function regenerateProfile(
  userId: number,
  plexToken: string
): Promise<DerivedProfile | null> {
  const config = getConfigValue("promotedAlbum");

  const weighted = await loadArtistWeights(userId, plexToken, {
    windowMs: config.playTrendWindowDays * 24 * 60 * 60 * 1000,
    ratingWeight: config.ratingWeight,
    distributionWeight: config.distributionWeight,
    minPlaysForDistribution: config.minPlaysForDistribution,
  });
  if (weighted.length === 0) return null;

  const topArtists = [...weighted]
    .sort((a, b) => b.viewCount - a.viewCount)
    .slice(0, config.topArtistsCount);

  const pickedArtists = weightedRandomPick(
    topArtists,
    (a) => a.viewCount,
    config.pickedArtistsCount
  );
  if (pickedArtists.length === 0) return null;

  const tagResults = await fetchTagResults(pickedArtists);
  const genericTags = new Set(config.genericTags.map((t) => t.toLowerCase()));
  const { genreVector, artistTags } = buildProfileArtifacts(
    tagResults,
    genericTags,
    config.tagsPerArtist
  );
  if (genreVector.length === 0) return null;

  const similarGraph = await buildSimilarGraph(topArtists, config);

  const existing = await getUserProfile(userId);
  const explorationHistory = existing
    ? parseDerivedProfile(existing.profile_json).explorationHistory
    : { albums: [], artists: [] };

  const profile: DerivedProfile = {
    genreVector,
    artistTags,
    similarGraph,
    explorationHistory,
  };

  await upsertUserProfile(userId, profile, computeConfigHash(config));
  return profile;
}

/** A persisted profile is fresh when its provenance matches and it is within TTL. */
export function isProfileFresh(
  row: UserProfile,
  config: PromotedAlbumConfig,
  now: number
): boolean {
  if (row.config_hash !== computeConfigHash(config)) return false;
  if (row.schema_version !== DERIVED_PROFILE_SCHEMA_VERSION) return false;
  if (parseDerivedProfile(row.profile_json).genreVector.length === 0) {
    return false;
  }
  const age = now - Date.parse(row.generated_at);
  return age < config.profileTtlMinutes * 60 * 1000;
}

/**
 * Read-first profile load: returns the persisted profile when fresh (bumping
 * `last_used_at`), otherwise regenerates and upserts. Guarded per-user so concurrent
 * callers share one regeneration instead of racing.
 */
export async function loadFreshProfile(
  userId: number,
  plexToken: string,
  config: PromotedAlbumConfig
): Promise<DerivedProfile | null> {
  return profileLock.acquire(String(userId), async () => {
    const existing = await getUserProfile(userId);
    if (existing && isProfileFresh(existing, config, Date.now())) {
      await touchProfileUsed(userId);
      return parseDerivedProfile(existing.profile_json);
    }
    return regenerateProfile(userId, plexToken);
  });
}
