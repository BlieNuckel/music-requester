import { resilientFetch } from "../resilientFetch";
import { getPlexConfig } from "./config";
import { getMusicSectionKeys } from "./sections";
import type {
  PlexRatedItem,
  PlexRatedItemMetadata,
  PlexRatedItemsResponse,
  PlexRatingType,
} from "./types";

const PAGE_SIZE = 100;

const DEFAULT_RATING_TYPES: PlexRatingType[] = [9, 10];

const KIND_BY_TYPE: Record<PlexRatingType, PlexRatedItem["kind"]> = {
  9: "album",
  10: "track",
};

const buildPageUrl = (
  baseUrl: string,
  sectionKey: string,
  type: PlexRatingType,
  start: number
): string =>
  `${baseUrl}/library/sections/${sectionKey}/all?type=${type}` +
  `&userRating%3E=1&sort=userRating:desc` +
  `&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${PAGE_SIZE}`;

const mapRatedItem = (
  raw: PlexRatedItemMetadata,
  type: PlexRatingType
): PlexRatedItem => {
  const kind = KIND_BY_TYPE[type];
  const isTrack = kind === "track";
  return {
    ratingKey: raw.ratingKey,
    kind,
    title: raw.title,
    artist: (isTrack ? raw.grandparentTitle : raw.parentTitle) ?? "",
    albumKey: isTrack ? raw.parentRatingKey : undefined,
    artistKey: isTrack ? raw.grandparentRatingKey : raw.parentRatingKey,
    rating: raw.userRating ?? 0,
  };
};

async function fetchRatedPage(
  baseUrl: string,
  headers: Record<string, string>,
  sectionKey: string,
  type: PlexRatingType,
  start: number
): Promise<{ items: PlexRatedItem[]; totalSize: number }> {
  const url = buildPageUrl(baseUrl, sectionKey, type, start);
  const res = await resilientFetch(url, { headers });
  if (!res.ok) throw new Error(`Plex returned ${res.status}`);

  const data: PlexRatedItemsResponse = await res.json();
  const container = data.MediaContainer;
  const metadata = container?.Metadata ?? [];
  const items = metadata
    .filter((m) => typeof m.userRating === "number")
    .map((m) => mapRatedItem(m, type));
  return { items, totalSize: container?.totalSize ?? items.length };
}

async function fetchRatedByType(
  baseUrl: string,
  headers: Record<string, string>,
  sectionKey: string,
  type: PlexRatingType
): Promise<PlexRatedItem[]> {
  const all: PlexRatedItem[] = [];
  let start = 0;
  for (;;) {
    const { items, totalSize } = await fetchRatedPage(
      baseUrl,
      headers,
      sectionKey,
      type,
      start
    );
    all.push(...items);
    start += PAGE_SIZE;
    if (items.length === 0 || start >= totalSize) break;
  }
  return all;
}

/**
 * Read the current user's rated music across every music section, via the per-user token
 * path. Uses a server-side `userRating>=1` filter so only the (small) rated set is
 * fetched — the full library is never scanned. Missing `userRating` is treated
 * as unrated and excluded by the filter; an item read with `userRating` absent
 * is also dropped client-side rather than coerced to 0.
 */
export async function getRatedItems(
  plexToken: string,
  types: PlexRatingType[] = DEFAULT_RATING_TYPES
): Promise<PlexRatedItem[]> {
  const { baseUrl, headers } = getPlexConfig(plexToken);
  const sectionKeys = await getMusicSectionKeys(baseUrl, headers);

  const perWalk = await Promise.all(
    sectionKeys.flatMap((sectionKey) =>
      types.map((type) => fetchRatedByType(baseUrl, headers, sectionKey, type))
    )
  );
  return perWalk.flat();
}

/**
 * The current user's rating for a single item, or `null` when it carries no `userRating`
 * (unrated). Reads `/library/metadata/{ratingKey}` directly — no section scan — and is used
 * to confirm an apparent un-rating before recording it, so an item merely filtered out of
 * the rated set (or a transient glitch) is never mistaken for a deliberate un-star.
 */
export async function getItemRating(
  plexToken: string,
  ratingKey: string
): Promise<number | null> {
  const { baseUrl, headers } = getPlexConfig(plexToken);
  const res = await resilientFetch(`${baseUrl}/library/metadata/${ratingKey}`, {
    headers,
  });
  if (!res.ok) throw new Error(`Plex returned ${res.status}`);

  const data: PlexRatedItemsResponse = await res.json();
  const meta = data.MediaContainer?.Metadata?.[0];
  return typeof meta?.userRating === "number" ? meta.userRating : null;
}
