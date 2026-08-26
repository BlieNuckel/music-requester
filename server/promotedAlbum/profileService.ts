import {
  deriveAlbumWeights,
  deriveArtistWeights,
  loadSignalBundle,
  type ArtistWeight,
  type ArtistWeightOptions,
  type SignalBundle,
} from "./artistWeights";
import {
  albumsByArtist,
  buildAlbumTags,
  fetchAlbumTags,
  plexAlbumGenres,
  selectTagTargets,
} from "./albumGenres";
import {
  attachSeriesSignals,
  loadArtistSeries,
  selectProfileSeries,
  type ArtistSeriesOptions,
} from "./artistSeries";
import { buildSimilarGraph } from "./explore";
import { loadKnownAlbums } from "./knownAlbums";
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

type TagResultEntry = {
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
type AlbumTagInputs = {
  bundle: SignalBundle;
  topArtists: ArtistWeight[];
  artistTags: DerivedProfile["artistTags"];
  config: PromotedAlbumConfig;
  weightOptions: ArtistWeightOptions;
  genericTags: Set<string>;
};

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

function buildArtistTags(
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

/**
 * The albums of the top artists, tagged and weighted, ready to be summed into the vector.
 * The Last.fm fan-out is bounded per artist by `albumTagsPerArtist`; every other album
 * resolves off the Plex genres the catalogue sweep already captured, at no request cost.
 */
async function buildProfileAlbumTags(
  inputs: AlbumTagInputs
): Promise<DerivedProfile["albumTags"]> {
  const { bundle, topArtists, artistTags, config, weightOptions, genericTags } =
    inputs;

  const byArtist = albumsByArtist(
    topArtists,
    deriveAlbumWeights(bundle, weightOptions),
    config.listeningWeight
  );
  const lastfm = await fetchAlbumTags(
    selectTagTargets(byArtist, config.albumTagsPerArtist)
  );

  return buildAlbumTags(
    byArtist,
    artistTags,
    lastfm,
    plexAlbumGenres(bundle.albumEvents),
    {
      tagsPerAlbum: config.tagsPerArtist,
      genericTags,
      listeningWeight: config.listeningWeight,
    }
  );
}

async function fetchTagResults(
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

/** The weighting knobs, resolved once so the album split is measured over the same window. */
function artistWeightOptions(config: PromotedAlbumConfig): ArtistWeightOptions {
  return {
    windowMs: config.playTrendWindowDays * DAY_MS,
    ratingWeight: config.ratingWeight,
    listeningWeight: config.listeningWeight,
    maxTrackMinutesForWeight: config.maxTrackMinutesForWeight,
  };
}

/** The series knobs, resolved from config so both the derivation and the stored bucket width agree. */
function seriesOptions(config: PromotedAlbumConfig): ArtistSeriesOptions {
  return {
    now: Date.now(),
    bucketMs: config.seriesBucketDays * DAY_MS,
    spanMs: config.seriesSpanDays * DAY_MS,
    recentBuckets: config.momentumRecentBuckets,
    capMs: Math.max(0, config.maxTrackMinutesForWeight) * 60_000,
    listeningWeight: config.listeningWeight,
  };
}

/**
 * Rebuild a user's derived profile from Plex top-artists + Last.fm tags and persist it.
 * Request-free (token in, profile out) so the Phase 3 scheduler can call it directly.
 * Returns null when the user has no top artists or every tag is generic; the existing
 * row (if any) is left untouched in that case. Existing exploration memory is carried
 * forward across the regenerate.
 *
 * Tags are fetched for *every* top artist rather than a random few. Sampling here froze one
 * draw into a profile that then drove every recommendation for the whole TTL; the sample
 * belongs at selection time, where it can be re-rolled per recommendation.
 */
export async function regenerateProfile(
  userId: number,
  plexToken: string
): Promise<DerivedProfile | null> {
  const config = getConfigValue("promotedAlbum");
  const weightOptions = artistWeightOptions(config);
  const bundle = await loadSignalBundle(userId, plexToken);
  const series = await loadArtistSeries(userId, seriesOptions(config));
  const weighted = attachSeriesSignals(
    deriveArtistWeights(bundle, weightOptions),
    series
  );
  if (weighted.length === 0) return null;

  const topArtists = [...weighted]
    .sort((a, b) => b.viewCount - a.viewCount)
    .slice(0, config.topArtistsCount);

  const tagResults = await fetchTagResults(topArtists);
  const genericTags = new Set(config.genericTags.map((t) => t.toLowerCase()));
  const artistTags = buildArtistTags(
    tagResults,
    genericTags,
    config.tagsPerArtist
  );
  const albumTags = await buildProfileAlbumTags({
    bundle,
    topArtists,
    artistTags,
    config,
    weightOptions,
    genericTags,
  });
  const genreVector = buildGenreVector(albumTags);
  if (genreVector.length === 0) return null;

  const similarGraph = await buildSimilarGraph(topArtists, config);

  const existing = await getUserProfile(userId);
  const explorationHistory = existing
    ? parseDerivedProfile(existing.profile_json).explorationHistory
    : { albums: [], artists: [] };

  const profile: DerivedProfile = {
    genreVector,
    artistTags,
    albumTags,
    similarGraph,
    artistSeries: selectProfileSeries(
      series,
      topArtists.map((a) => a.name),
      config.topArtistsCount,
      config.seriesBucketDays * DAY_MS
    ),
    knownAlbums: await loadKnownAlbums(userId),
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
