import { getAlbumTopTags } from "../api/lastfm/albums";
import {
  reconstructAlbumTrackCounts,
  toPlayEquivalents,
} from "../services/profile/signalIngestion";
import { createLogger } from "../logger";
import type { AlbumPlayRollup } from "../services/profile/signalIngestion";
import type { UserSignalEvent } from "../db/entity/UserSignalEvent";
import type {
  AlbumTagSource,
  DerivedProfile,
  ProfileAlbumTags,
} from "../db/entity/UserProfile";

export type AlbumTag = { name: string; count: number };

/** One artist's albums over the measured window, most-listened first. */
export type ArtistAlbums = {
  name: string;
  viewCount: number;
  albums: AlbumPlayRollup[];
};

export type AlbumTagOptions = {
  /** Tags kept per album, after generic ones are dropped. */
  tagsPerAlbum: number;
  genericTags: Set<string>;
  /** Same knob the weights use, so an album's share is denominated as its artist's weight is. */
  listeningWeight: number;
};

type ResolvedTags = { tags: AlbumTag[]; source: AlbumTagSource };

const log = createLogger("album-genres");

/**
 * Plex agent genres per album `ratingKey`, folded out of the catalogue series the album
 * sweep already writes. Albums Plex tagged with nothing are left out entirely rather than
 * stored as an empty list, so a caller can treat "absent" as "no genre" without a check.
 */
export function plexAlbumGenres(
  albumEvents: UserSignalEvent[]
): Map<string, string[]> {
  const genres = new Map<string, string[]>();
  for (const [key, album] of reconstructAlbumTrackCounts(
    albumEvents,
    Infinity
  )) {
    if (album.genres && album.genres.length > 0) genres.set(key, album.genres);
  }
  return genres;
}

/** Play-equivalents for one album, denominated exactly as its artist's weight is. */
const albumPlayEquivalents = (
  album: AlbumPlayRollup,
  listeningWeight: number
): number =>
  toPlayEquivalents(
    { plays: album.playCount, listenedMs: album.listenedMs },
    listeningWeight
  );

/**
 * Each artist's albums, most-listened first, joined onto the weight the recommender ranks
 * that artist by. Artists with no album rows at all still appear, with an empty list —
 * their weight has to reach the vector through the artist-level fallback or it goes missing.
 *
 * Joined on artist *name* because that is the key the weight set uses; `artistKey` groups
 * the rollup itself but cannot join to a weight that only ever had a name.
 */
export function albumsByArtist(
  artists: { name: string; viewCount: number }[],
  albums: AlbumPlayRollup[],
  listeningWeight: number
): ArtistAlbums[] {
  const wanted = new Map<string, ArtistAlbums>(
    artists.map((artist) => [
      artist.name,
      { name: artist.name, viewCount: artist.viewCount, albums: [] },
    ])
  );

  for (const album of albums) {
    const entry = wanted.get(album.artistName);
    if (!entry) continue;
    if (albumPlayEquivalents(album, listeningWeight) <= 0) continue;
    entry.albums.push(album);
  }

  for (const entry of wanted.values()) {
    entry.albums.sort(
      (a, b) =>
        albumPlayEquivalents(b, listeningWeight) -
        albumPlayEquivalents(a, listeningWeight)
    );
  }
  return Array.from(wanted.values());
}

/**
 * The albums worth spending a Last.fm call on: the `perArtist` most-listened per artist.
 * Bounded per artist rather than globally so one dominant artist can't eat the whole budget
 * and leave the other nine on Plex's coarse vocabulary.
 */
export function selectTagTargets(
  byArtist: ArtistAlbums[],
  perArtist: number
): AlbumPlayRollup[] {
  if (perArtist <= 0) return [];
  return byArtist.flatMap((artist) => artist.albums.slice(0, perArtist));
}

/**
 * Last.fm tags for the selected albums, keyed by album key. A lookup that fails or comes
 * back empty is simply absent, which drops that album to the Plex genre and then to its
 * artist's tags — the same degradation as an album Last.fm has never heard of.
 */
export async function fetchAlbumTags(
  targets: AlbumPlayRollup[]
): Promise<Map<string, AlbumTag[]>> {
  const results = await Promise.all(
    targets.map(async (album) => {
      if (!album.title || !album.artistName) return null;
      try {
        const tags = await getAlbumTopTags(album.artistName, album.title);
        return tags.length > 0 ? ([album.albumKey, tags] as const) : null;
      } catch {
        return null;
      }
    })
  );

  const found = new Map<string, AlbumTag[]>();
  for (const result of results) {
    if (result) found.set(result[0], result[1]);
  }
  if (targets.length > 0) {
    log.debug(`Album tags: ${found.size}/${targets.length} albums tagged`);
  }
  return found;
}

const keepTags = (
  tags: AlbumTag[],
  genericTags: Set<string>,
  limit: number
): AlbumTag[] =>
  tags.filter((t) => !genericTags.has(t.name.toLowerCase())).slice(0, limit);

/**
 * Plex genres carried as tags. Every genre gets the same count because Plex ranks nothing —
 * an equal count makes {@link normalizedTagWeights} split the album's weight evenly, which
 * is the only honest reading of an unordered list.
 */
const asTags = (genres: string[]): AlbumTag[] =>
  genres.map((name) => ({ name, count: 1 }));

/**
 * One album's genres, tried richest source first: the Last.fm album tags where we spent a
 * call, the Plex agent genre next, the artist's own tags last. A source that survives
 * generic-tag filtering with nothing left is skipped rather than accepted empty, so an album
 * tagged only "seen live" still inherits something usable.
 */
export function resolveAlbumTags(
  album: AlbumPlayRollup,
  lastfm: Map<string, AlbumTag[]>,
  plex: Map<string, string[]>,
  artistTags: AlbumTag[],
  options: AlbumTagOptions
): ResolvedTags {
  const { genericTags, tagsPerAlbum } = options;

  const fromLastfm = keepTags(
    lastfm.get(album.albumKey) ?? [],
    genericTags,
    tagsPerAlbum
  );
  if (fromLastfm.length > 0) {
    return { tags: fromLastfm, source: "lastfm-album" };
  }

  const fromPlex = keepTags(
    asTags(plex.get(album.albumKey) ?? []),
    genericTags,
    tagsPerAlbum
  );
  if (fromPlex.length > 0) return { tags: fromPlex, source: "plex-album" };

  return {
    tags: keepTags(artistTags, genericTags, tagsPerAlbum),
    source: "artist",
  };
}

/**
 * One artist's albums as genre-bearing units, each holding its share of the artist's weight.
 * The shares sum to the artist's weight exactly, so moving the attachment point down to the
 * album divides an artist's influence rather than changing how much of it there is — with no
 * album genres anywhere, the vector this produces is numerically identical to the artist-level
 * one it replaces.
 *
 * An artist with no album rows, or none carrying listening, keeps one entry holding its whole
 * weight under its own tags. That covers the legacy artist-level series, which records no album.
 */
function artistAlbumTags(
  artist: ArtistAlbums,
  artistTags: AlbumTag[],
  lastfm: Map<string, AlbumTag[]>,
  plex: Map<string, string[]>,
  options: AlbumTagOptions
): ProfileAlbumTags[] {
  const equivalents = artist.albums.map((album) =>
    albumPlayEquivalents(album, options.listeningWeight)
  );
  const total = equivalents.reduce((sum, value) => sum + value, 0);

  if (total <= 0) {
    return [
      {
        albumKey: "",
        title: "",
        artistName: artist.name,
        weight: artist.viewCount,
        source: "artist",
        tags: keepTags(artistTags, options.genericTags, options.tagsPerAlbum),
      },
    ];
  }

  return artist.albums.map((album, index) => {
    const resolved = resolveAlbumTags(album, lastfm, plex, artistTags, options);
    return {
      albumKey: album.albumKey,
      title: album.title,
      artistName: artist.name,
      weight: artist.viewCount * (equivalents[index] / total),
      source: resolved.source,
      tags: resolved.tags,
    };
  });
}

/**
 * Every top artist's listening, split across their albums and tagged. Albums whose tags all
 * turn out generic are dropped: they can contribute nothing to the vector, and keeping them
 * only makes the stored document larger.
 */
export function buildAlbumTags(
  byArtist: ArtistAlbums[],
  artistTags: DerivedProfile["artistTags"],
  lastfm: Map<string, AlbumTag[]>,
  plex: Map<string, string[]>,
  options: AlbumTagOptions
): ProfileAlbumTags[] {
  const tagsByArtist = new Map(artistTags.map((a) => [a.name, a.tags]));

  return byArtist
    .flatMap((artist) =>
      artistAlbumTags(
        artist,
        tagsByArtist.get(artist.name) ?? [],
        lastfm,
        plex,
        options
      )
    )
    .filter((album) => album.tags.length > 0);
}
