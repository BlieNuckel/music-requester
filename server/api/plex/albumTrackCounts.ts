import { resilientFetch } from "../resilientFetch";
import { getPlexConfig } from "./config";
import { getMusicSectionKeys } from "./sections";
import type { PlexAlbumMetadata, PlexAlbumsResponse } from "./types";

/** One album's track count plus the artist it belongs to. */
export type AlbumTrackCount = {
  ratingKey: string;
  title: string;
  artistKey: string;
  artistName: string;
  trackCount: number;
};

type AlbumPage = {
  items: AlbumTrackCount[];
  pageCount: number;
  totalSize: number;
};

const PAGE_SIZE = 500;

const buildPageUrl = (
  baseUrl: string,
  sectionKey: string,
  start: number
): string =>
  `${baseUrl}/library/sections/${sectionKey}/all?type=9` +
  `&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${PAGE_SIZE}`;

const trackCountOf = (raw: PlexAlbumMetadata): number =>
  raw.leafCount ?? raw.childCount ?? 0;

const mapAlbum = (raw: PlexAlbumMetadata): AlbumTrackCount => ({
  ratingKey: raw.ratingKey,
  title: raw.title,
  artistKey: raw.parentRatingKey ?? "",
  artistName: raw.parentTitle ?? "",
  trackCount: trackCountOf(raw),
});

async function fetchPage(
  baseUrl: string,
  headers: Record<string, string>,
  sectionKey: string,
  start: number
): Promise<AlbumPage> {
  const res = await resilientFetch(buildPageUrl(baseUrl, sectionKey, start), {
    headers,
  });
  if (!res.ok) throw new Error(`Plex returned ${res.status}`);

  const data: PlexAlbumsResponse = await res.json();
  const container = data.MediaContainer;
  const metadata = container?.Metadata ?? [];
  const items = metadata
    .filter((raw) => raw.parentTitle || raw.parentRatingKey)
    .filter((raw) => trackCountOf(raw) > 0)
    .map(mapAlbum);

  return {
    items,
    pageCount: metadata.length,
    totalSize: container?.totalSize ?? metadata.length,
  };
}

/**
 * One music section's albums, paginated to completion. Unlike the played-track walk this
 * has no early exit — the whole point is the albums nothing has been played from — but an
 * album listing is roughly an order of magnitude smaller than a track listing, so a full
 * walk is a handful of requests rather than one per 500 played tracks.
 *
 * Termination is keyed on the raw page count, so albums dropped for missing an artist or a
 * track count can't be mistaken for the end of the listing.
 */
async function walkSection(
  baseUrl: string,
  headers: Record<string, string>,
  sectionKey: string
): Promise<AlbumTrackCount[]> {
  const all: AlbumTrackCount[] = [];
  let start = 0;
  for (;;) {
    const page = await fetchPage(baseUrl, headers, sectionKey, start);
    all.push(...page.items);
    start += PAGE_SIZE;
    if (page.pageCount < PAGE_SIZE || start >= page.totalSize) break;
  }
  return all;
}

/**
 * Every album across every music section, with how many tracks it holds. This is what tells
 * an artist the library only has one track by apart from an artist whose other eleven tracks
 * were never played — the played-track sweep sees those two identically. Sections are walked
 * sequentially so a server with several music libraries doesn't get several concurrent sweeps.
 */
export async function getAllAlbumTrackCounts(
  plexToken: string
): Promise<AlbumTrackCount[]> {
  const { baseUrl, headers } = getPlexConfig(plexToken);
  const sectionKeys = await getMusicSectionKeys(baseUrl, headers);

  const all: AlbumTrackCount[] = [];
  for (const sectionKey of sectionKeys) {
    all.push(...(await walkSection(baseUrl, headers, sectionKey)));
  }
  return all;
}
