import { getAlbumTopTags } from "../api/lastfm/albums";
import {
  reconstructAlbumTrackCounts,
  toPlayEquivalents,
} from "../services/profile/signalIngestion";
import { classifyTag, foldTag } from "../genres/classify";
import { createLogger } from "../logger";
import type { AlbumPlayRollup } from "../services/profile/signalIngestion";
import type { UserSignalEvent } from "../db/entity/UserSignalEvent";
import type {
  AlbumTagSource,
  ClassifiedOtherTag,
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

type ResolvedTags = {
  tags: AlbumTag[];
  source: AlbumTagSource;
  other: ClassifiedOtherTag[];
};

/** One source's tags split by whether they can carry weight into the genre vector. */
export type PartitionedTags = {
  genres: AlbumTag[];
  other: ClassifiedOtherTag[];
};

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

/**
 * Split one source's tags into the genres that can carry weight and everything else.
 *
 * Everything the year and junk heuristics used to guess at is now a vocabulary lookup, which
 * is the point: we stop trying to enumerate what *isn't* a genre — an unbounded set — and
 * check membership of what is. Non-genre tags are kept rather than dropped so an artist we
 * know a region for but no genre reads as exactly that, instead of as an artist we know
 * nothing about.
 *
 * Two things are still handled here rather than by the vocabulary. A tag equal to the
 * artist's own name is self-reference, not vocabulary, and Last.fm album tags are full of it.
 * And genre tags are deduplicated *after* canonicalization, keeping the highest count —
 * without that, an album tagged both `Hip-Hop` and `hip hop` would contribute the same genre
 * twice and take double its share of the album's weight.
 */
export function partitionTags(
  tags: AlbumTag[],
  artistName: string,
  options: AlbumTagOptions
): PartitionedTags {
  const { genericTags, tagsPerAlbum } = options;
  const self = foldTag(artistName);

  const genres = new Map<string, AlbumTag>();
  const other: ClassifiedOtherTag[] = [];

  for (const tag of tags) {
    const key = foldTag(tag.name);
    if (!key || key === self) continue;

    const classified = classifyTag(tag.name);
    if (classified.class !== "genre") {
      if (!genericTags.has(key)) {
        other.push({
          name: tag.name,
          canonical: classified.canonical,
          class: classified.class,
        });
      }
      continue;
    }

    // Generic tags are matched on the canonical name: blocking "hip hop" has to block the
    // "rap" that resolves to it, or the block is decided by which spelling happened to arrive.
    if (genericTags.has(foldTag(classified.canonical))) continue;

    const existing = genres.get(classified.canonical);
    if (!existing) {
      genres.set(classified.canonical, {
        name: classified.canonical,
        count: tag.count,
      });
    } else if (tag.count > existing.count) {
      existing.count = tag.count;
    }
  }

  return { genres: [...genres.values()].slice(0, tagsPerAlbum), other };
}

/**
 * Plex genres carried as tags. Every genre gets the same count because Plex ranks nothing —
 * an equal count makes {@link normalizedTagWeights} split the album's weight evenly, which
 * is the only honest reading of an unordered list.
 */
const asTags = (genres: string[]): AlbumTag[] =>
  genres.map((name) => ({ name, count: 1 }));

/**
 * One album's genres, tried richest source first: the Last.fm album tags where we spent a
 * call, the Plex agent genre next, the artist's own tags last. A source yielding no *genre*
 * is skipped rather than accepted, so an album Last.fm knows only as "nigerian" still
 * inherits its artist's genres.
 *
 * Non-genre tags are collected from every source tried, not just the winning one. That is
 * deliberate: the album above would otherwise lose the one region we know about it the
 * moment a later source supplied a genre.
 */
export function resolveAlbumTags(
  album: AlbumPlayRollup,
  lastfm: Map<string, AlbumTag[]>,
  plex: Map<string, string[]>,
  artistTags: AlbumTag[],
  options: AlbumTagOptions
): ResolvedTags {
  const sources: [AlbumTagSource, AlbumTag[]][] = [
    ["lastfm-album", lastfm.get(album.albumKey) ?? []],
    ["plex-album", asTags(plex.get(album.albumKey) ?? [])],
    ["artist", artistTags],
  ];

  const other: ClassifiedOtherTag[] = [];
  for (const [source, tags] of sources) {
    const partitioned = partitionTags(tags, album.artistName, options);
    other.push(...partitioned.other);
    if (partitioned.genres.length > 0) {
      return { tags: partitioned.genres, source, other: dedupeOther(other) };
    }
  }
  return { tags: [], source: "artist", other: dedupeOther(other) };
}

/** One entry per canonical name — the same region arrives from several sources. */
function dedupeOther(tags: ClassifiedOtherTag[]): ClassifiedOtherTag[] {
  const seen = new Map<string, ClassifiedOtherTag>();
  for (const tag of tags) {
    if (!seen.has(tag.canonical)) seen.set(tag.canonical, tag);
  }
  return [...seen.values()];
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
    const partitioned = partitionTags(artistTags, artist.name, options);
    return [
      {
        albumKey: "",
        title: "",
        artistName: artist.name,
        weight: artist.viewCount,
        source: "artist",
        tags: partitioned.genres,
        otherTags: partitioned.other,
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
      otherTags: resolved.other,
    };
  });
}

/**
 * Every top artist's listening, split across their albums and tagged. An album that resolved
 * to no genre is kept only when it carries something else we recognised — a region says
 * "we know where this is from but not what it is", which is worth storing, while an album
 * that produced nothing at all is just weight with no attribute and only bloats the document.
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
    .filter((album) => album.tags.length > 0 || album.otherTags.length > 0);
}
