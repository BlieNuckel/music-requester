import { resilientFetch } from "../resilientFetch";
import { getPlexConfig } from "./config";
import { getMusicSectionKeys } from "./sections";
import type {
  PlexArtistsResponse,
  PlexHistoryResponse,
  PlexTopArtist,
  TopArtistsRange,
} from "./types";

const RANGE_DAYS: Record<Exclude<TopArtistsRange, "all">, number> = {
  "4weeks": 28,
  "6months": 183,
  "12months": 365,
};

const HISTORY_FETCH_SIZE = 5000;
const SECONDS_PER_DAY = 86400;

const buildThumbUrl = (thumb?: string): string =>
  thumb ? `/api/plex/thumb?path=${encodeURIComponent(thumb)}` : "";

async function getTopArtistsAllTime(
  baseUrl: string,
  headers: Record<string, string>,
  sectionKey: string,
  limit: number
): Promise<PlexTopArtist[]> {
  const url = `${baseUrl}/library/sections/${sectionKey}/all?type=8&sort=viewCount:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=${limit}`;
  const response = await resilientFetch(url, { headers });
  if (!response.ok) throw new Error(`Plex returned ${response.status}`);

  const data: PlexArtistsResponse = await response.json();
  const metadata = data.MediaContainer?.Metadata || [];

  return metadata
    .filter((a) => a.viewCount > 0)
    .map((a) => ({
      name: a.title,
      viewCount: a.viewCount || 0,
      thumb: buildThumbUrl(a.thumb),
      genres: (a.Genre || []).map((g) => g.tag),
    }));
}

async function getTopArtistsByHistory(
  baseUrl: string,
  headers: Record<string, string>,
  sectionKey: string,
  sinceSeconds: number
): Promise<PlexTopArtist[]> {
  const url = `${baseUrl}/status/sessions/history/all?librarySectionID=${sectionKey}&viewedAt%3E=${sinceSeconds}&sort=viewedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=${HISTORY_FETCH_SIZE}`;
  const response = await resilientFetch(url, { headers });
  if (!response.ok) throw new Error(`Plex returned ${response.status}`);

  const data: PlexHistoryResponse = await response.json();
  const entries = data.MediaContainer?.Metadata || [];

  const counts = new Map<string, { count: number; thumb: string }>();
  for (const entry of entries) {
    const name = entry.grandparentTitle;
    if (!name) continue;

    const existing = counts.get(name);
    if (existing) {
      existing.count += 1;
      if (!existing.thumb && entry.grandparentThumb) {
        existing.thumb = entry.grandparentThumb;
      }
    } else {
      counts.set(name, { count: 1, thumb: entry.grandparentThumb || "" });
    }
  }

  return [...counts.entries()].map(([name, { count, thumb }]) => ({
    name,
    viewCount: count,
    thumb: buildThumbUrl(thumb),
    genres: [],
  }));
}

/**
 * Fold each section's list into one ranking. An artist present in two music sections is one
 * artist to the user, so their counts add rather than competing for a slot.
 */
function mergeTopArtists(
  perSection: PlexTopArtist[][],
  limit: number
): PlexTopArtist[] {
  const merged = new Map<string, PlexTopArtist>();
  for (const artist of perSection.flat()) {
    const existing = merged.get(artist.name);
    if (!existing) {
      merged.set(artist.name, { ...artist, genres: [...artist.genres] });
      continue;
    }
    existing.viewCount += artist.viewCount;
    if (!existing.thumb) existing.thumb = artist.thumb;
    for (const genre of artist.genres) {
      if (!existing.genres.includes(genre)) existing.genres.push(genre);
    }
  }

  return [...merged.values()]
    .sort((a, b) => b.viewCount - a.viewCount)
    .slice(0, limit);
}

export async function getTopArtists(
  plexToken: string,
  limit: number,
  range: TopArtistsRange = "all"
): Promise<PlexTopArtist[]> {
  const { baseUrl, headers } = getPlexConfig(plexToken);
  const sectionKeys = await getMusicSectionKeys(baseUrl, headers);

  if (range === "all") {
    const perSection = await Promise.all(
      sectionKeys.map((key) =>
        getTopArtistsAllTime(baseUrl, headers, key, limit)
      )
    );
    return mergeTopArtists(perSection, limit);
  }

  const sinceSeconds =
    Math.floor(Date.now() / 1000) - RANGE_DAYS[range] * SECONDS_PER_DAY;
  const perSection = await Promise.all(
    sectionKeys.map((key) =>
      getTopArtistsByHistory(baseUrl, headers, key, sinceSeconds)
    )
  );
  return mergeTopArtists(perSection, limit);
}
