import type { ArtistWeight } from "./artistWeights";

import { selectProfileSeries, type ArtistSeries } from "./artistSeries";
import { runGraph } from "../recommenderGraph/runtime/executor";
import { PROFILE_BODIES } from "./profileGraph";
import { getArtistTopTags } from "../api/lastfm/artists";
import { getConfigValue } from "../config";
import type { PromotedAlbumConfig } from "../config";
import { AsyncLock } from "../api/asyncLock";
import { createLogger } from "../logger";
import {
  getUserProfile,
  upsertUserProfile,
  touchProfileUsed,
  computeConfigHash,
  parseDerivedProfile,
} from "../db/userProfile";
import type { UserProfile, DerivedProfile } from "../db/entity/UserProfile";
import { DERIVED_PROFILE_SCHEMA_VERSION } from "../db/entity/UserProfile";

export type TagResultEntry = {
  artist: ArtistWeight;
  tags: { name: string; count: number }[];
};

/**
 * What a live request should render right now. `building` means the user has no usable
 * profile yet and one is being built off-request — distinct from a ready profile that
 * simply produced nothing, which is what the caller would otherwise have to guess.
 */
export type ProfileLoad =
  { status: "ready"; profile: DerivedProfile } | { status: "building" };

/** Everything {@link buildProfileAlbumTags} needs, gathered rather than passed one by one. */

type TagAccumulator = {
  displayName: string;
  weight: number;
  fromArtists: Set<string>;
};

/**
 * The minimal shape the vector is summed from: something carrying tags, a weight, and the
 * artist it belongs to. Albums are what the profile stores; artists satisfy it too, which is
 * how a profile written before album tags existed still builds a vector.
 */
export type GenreUnit = {
  artistName: string;
  weight: number;
  tags: { name: string; count: number }[];
};

/**
 * Per-user lock so a live request and a background regeneration can't both rebuild
 * the same profile and race the upsert. Keyed by user id.
 */
const profileLock = new AsyncLock();

/** Users whose off-request build is already scheduled, so repeat loads don't pile up. */
const buildsInFlight = new Set<number>();

const log = createLogger("profile-service");

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

/** A profile's artists as genre units, for reading a profile stored before album tags. */
export function artistGenreUnits(
  artistTags: DerivedProfile["artistTags"]
): GenreUnit[] {
  return artistTags.map((artist) => ({
    artistName: artist.name,
    weight: artist.viewCount,
    tags: artist.tags,
  }));
}

/**
 * Merge a set of genre units into one weighted vector, each contributing exactly its weight.
 * Exported because selection builds the same vector from a per-pick sample of the stored
 * artists' albums — one definition keeps the vector a recommendation is drawn from identical
 * in shape to the one stored on the profile.
 *
 * `fromArtists` stays keyed on the artist even now that albums are the unit: it answers "who
 * put this tag in my vector", and no consumer has ever wanted the record rather than the name.
 */
export function buildGenreVector(
  units: GenreUnit[]
): DerivedProfile["genreVector"] {
  const tagMap = new Map<string, TagAccumulator>();

  for (const { artistName, weight, tags } of units) {
    const weights = normalizedTagWeights(tags, weight);
    for (const [index, tag] of tags.entries()) {
      const key = tag.name.toLowerCase();
      const existing = tagMap.get(key);
      if (existing) {
        existing.weight += weights[index];
        existing.fromArtists.add(artistName);
      } else {
        tagMap.set(key, {
          displayName: tag.name,
          weight: weights[index],
          fromArtists: new Set([artistName]),
        });
      }
    }
  }

  return Array.from(tagMap.values()).map((v) => ({
    tag: v.displayName,
    weight: v.weight,
    fromArtists: Array.from(v.fromArtists),
  }));
}

export function buildArtistTags(
  tagResults: TagResultEntry[],
  genericTags: Set<string>,
  tagsPerArtist: number
): DerivedProfile["artistTags"] {
  return tagResults.map(({ artist, tags }) => ({
    name: artist.name,
    viewCount: artist.viewCount,
    tags: tags
      .filter((t) => !genericTags.has(t.name.toLowerCase()))
      .slice(0, tagsPerArtist),
    ratingMultiplier: artist.ratingMultiplier,
  }));
}

export async function fetchTagResults(
  artists: ArtistWeight[]
): Promise<TagResultEntry[]> {
  return Promise.all(
    artists.map(async (artist) => {
      try {
        return { artist, tags: await getArtistTopTags(artist.name) };
      } catch {
        return { artist, tags: [] };
      }
    })
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rebuild a user's derived profile and persist it. Request-free (token in, profile out) so a
 * scheduler can call it directly. Returns null when the user has no top artists or every tag
 * is generic; the existing row is left untouched in that case, and the exploration memory is
 * carried forward across the rebuild.
 *
 * The sequence is the graph's, not this function's. It used to be written out here — some
 * seventeen calls threading two hand-built option objects — while the same sequence was also
 * drawn in the node registry, and nothing made the two agree. Asking the runtime for
 * `profileDocument` runs exactly what that node depends on, so the drawing is the pipeline
 * rather than a description of it that can rot.
 *
 * The signal log is `given` rather than run: a profile build reads what the capture sweep and
 * the session poller have already written, on their own schedules.
 */
export async function regenerateProfile(
  userId: number,
  plexToken: string
): Promise<DerivedProfile | null> {
  const config = getConfigValue("promotedAlbum");
  const { outputs } = await runGraph(
    [
      "genreVector",
      "artistTags",
      "albumTags",
      "similarGraph",
      "attachSeries",
      "artistSeries",
      "knownAlbums",
    ],
    PROFILE_BODIES,
    { userId, plexToken, config, now: Date.now() },
    new Map([["signalLog", "persisted"]])
  );

  const artistTags = outputs.get("artistTags") as DerivedProfile["artistTags"];
  const genreVector = outputs.get(
    "genreVector"
  ) as DerivedProfile["genreVector"];
  if (artistTags.length === 0 || genreVector.length === 0) return null;

  const existing = await getUserProfile(userId);
  const topArtists = outputs.get("topArtists") as ArtistWeight[];

  const profile: DerivedProfile = {
    genreVector,
    artistTags,
    albumTags: outputs.get("albumTags") as DerivedProfile["albumTags"],
    similarGraph: outputs.get("similarGraph") as DerivedProfile["similarGraph"],
    artistSeries: selectProfileSeries(
      outputs.get("artistSeries") as ArtistSeries[],
      topArtists.map((artist) => artist.name),
      config.topArtistsCount,
      config.seriesBucketDays * DAY_MS
    ),
    knownAlbums: outputs.get("knownAlbums") as string[],
    explorationHistory: existing
      ? parseDerivedProfile(existing.profile_json).explorationHistory
      : { albums: [], artists: [] },
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

/** A stored profile is worth serving as long as it has a vector to pick a tag from. */
function usableProfile(row: UserProfile | null): DerivedProfile | null {
  if (!row) return null;
  const profile = parseDerivedProfile(row.profile_json);
  return profile.genreVector.length > 0 ? profile : null;
}

/**
 * Read-first profile load: returns the persisted profile when fresh (bumping
 * `last_used_at`), otherwise regenerates and upserts. Guarded per-user so concurrent
 * callers share one regeneration instead of racing.
 *
 * A regeneration returns null when the sampled artists happen to produce only generic
 * tags. That is a bad roll, not a verdict on the user, so the stored profile is served
 * instead of nothing — it was good enough a moment ago, and the next roll re-samples.
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

    const regenerated = await regenerateProfile(userId, plexToken);
    if (regenerated) return regenerated;

    const stale = usableProfile(existing);
    log.warn(
      stale
        ? `Regeneration for user ${userId} produced no genres; serving the stored profile`
        : `Regeneration for user ${userId} produced no genres and there is nothing stored`
    );
    return stale;
  });
}

/**
 * Schedule a rebuild off the request path. The build fans out to Plex, MusicBrainz,
 * ListenBrainz and Last.fm and can run for minutes on a cold start, which is far too long
 * to hold an HTTP request open — so callers start it and render a "building" state instead
 * of awaiting it. Repeat calls while one is running are dropped rather than queued.
 */
export function startProfileBuild(userId: number, plexToken: string): void {
  if (buildsInFlight.has(userId)) return;
  buildsInFlight.add(userId);

  void loadFreshProfile(userId, plexToken, getConfigValue("promotedAlbum"))
    .catch((error) =>
      log.error(`Profile build failed for user ${userId}`, error)
    )
    .finally(() => buildsInFlight.delete(userId));
}

/**
 * What a live request should render right now, without ever blocking on a build. A fresh
 * profile is served as is; a stale one is served while a rebuild runs behind it, since it
 * describes the same taste it did an hour ago. Only a user with nothing usable stored gets
 * `building`, and their build starts here — waiting for the next poller tick would leave a
 * first-time user staring at an empty Discover page for up to an hour.
 */
export async function loadProfileForRequest(
  userId: number,
  plexToken: string,
  config: PromotedAlbumConfig
): Promise<ProfileLoad> {
  const existing = await getUserProfile(userId);
  if (existing && isProfileFresh(existing, config, Date.now())) {
    await touchProfileUsed(userId);
    return {
      status: "ready",
      profile: parseDerivedProfile(existing.profile_json),
    };
  }

  startProfileBuild(userId, plexToken);

  const stale = usableProfile(existing);
  if (!stale) return { status: "building" };

  // Keeps the row inside the regen sweep's activity window while its rebuild runs.
  await touchProfileUsed(userId);
  return { status: "ready", profile: stale };
}
