import { resilientFetch } from "../resilientFetch";
import { getPlexConfig } from "./config";
import { getMusicSectionKey } from "./sections";
import type { PlexTrackMetadata, PlexTracksResponse } from "./types";

/** One track's cumulative play count plus the album/artist it rolls up into. */
export type TrackPlayCount = {
  ratingKey: string;
  title: string;
  artistKey: string;
  artistName: string;
  albumKey: string;
  albumTitle: string;
  viewCount: number;
};

type TrackPage = {
  items: TrackPlayCount[];
  pageCount: number;
  playedCount: number;
  totalSize: number;
};

const PAGE_SIZE = 500;

const buildPageUrl = (
  baseUrl: string,
  sectionKey: string,
  start: number
): string =>
  `${baseUrl}/library/sections/${sectionKey}/all?type=10&sort=viewCount:desc` +
  `&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${PAGE_SIZE}`;

const isPlayed = (raw: PlexTrackMetadata): boolean => (raw.viewCount ?? 0) > 0;

const mapTrack = (raw: PlexTrackMetadata): TrackPlayCount => ({
  ratingKey: raw.ratingKey,
  title: raw.title,
  artistKey: raw.grandparentRatingKey ?? "",
  artistName: raw.grandparentTitle ?? "",
  albumKey: raw.parentRatingKey ?? "",
  albumTitle: raw.parentTitle ?? "",
  viewCount: raw.viewCount ?? 0,
});

async function fetchPage(
  baseUrl: string,
  headers: Record<string, string>,
  sectionKey: string,
  start: number
): Promise<TrackPage> {
  const res = await resilientFetch(buildPageUrl(baseUrl, sectionKey, start), {
    headers,
  });
  if (!res.ok) throw new Error(`Plex returned ${res.status}`);

  const data: PlexTracksResponse = await res.json();
  const container = data.MediaContainer;
  const metadata = container?.Metadata ?? [];
  const played = metadata.filter(isPlayed);
  const items = played
    .filter((raw) => raw.grandparentTitle || raw.grandparentRatingKey)
    .map(mapTrack);

  return {
    items,
    pageCount: metadata.length,
    playedCount: played.length,
    totalSize: container?.totalSize ?? metadata.length,
  };
}

/**
 * Every played track in the library, paginated to completion. Sorted by `viewCount:desc`,
 * so the walk stops at the first page containing an unplayed track — the whole remainder
 * is unplayed. That is what keeps this affordable: it costs one request per ~500 *played*
 * tracks, not per 500 library tracks. Intended for the background plays-capture job
 * against a local PMS, where walking the library carries no rate limit.
 *
 * Termination is keyed on the raw page count rather than the mapped one, so a played track
 * dropped for having no artist attribution can't be mistaken for the unplayed tail.
 */
export async function getAllTrackPlayCounts(
  plexToken: string
): Promise<TrackPlayCount[]> {
  const { baseUrl, headers } = getPlexConfig(plexToken);
  const sectionKey = await getMusicSectionKey(baseUrl, headers);

  const all: TrackPlayCount[] = [];
  let start = 0;
  for (;;) {
    const page = await fetchPage(baseUrl, headers, sectionKey, start);
    all.push(...page.items);
    start += PAGE_SIZE;
    if (page.playedCount < page.pageCount) break;
    if (page.pageCount < PAGE_SIZE || start >= page.totalSize) break;
  }
  return all;
}
