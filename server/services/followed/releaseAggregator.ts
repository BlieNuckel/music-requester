import { fetchReleaseGroupsForArtist } from "../../api/musicbrainz/releaseGroups";
import { getArtistAlbumsByName as getDeezerAlbums } from "../../api/deezer/albums";
import { createLogger } from "../../logger";
import type { ReleaseSource } from "../../db/index";

export type AggregatedRelease = {
  release_key: string;
  source: ReleaseSource;
  album_title: string;
  release_date: string | null;
  external_id: string | null;
};

const log = createLogger("releaseAggregator");

const TITLE_NOISE = /[\s.,!?'"()[\]{}\-_:;]+/g;

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(TITLE_NOISE, "").trim();
}

function yearMonth(date: string | null | undefined): string {
  if (!date) return "0000-00";
  return date.slice(0, 7);
}

function buildKey(title: string, date: string | null | undefined): string {
  return `${normalizeTitle(title)}|${yearMonth(date)}`;
}

async function fetchFromMusicBrainz(
  artistMbid: string
): Promise<AggregatedRelease[]> {
  try {
    const groups = await fetchReleaseGroupsForArtist(artistMbid, "background");
    return groups.map((rg) => ({
      release_key: buildKey(rg.title, rg["first-release-date"]),
      source: "musicbrainz" as const,
      album_title: rg.title,
      release_date: rg["first-release-date"] || null,
      external_id: rg.id,
    }));
  } catch (error) {
    log.error(`MB fetch failed for ${artistMbid}`, error);
    return [];
  }
}

async function fetchFromDeezer(
  artistName: string
): Promise<AggregatedRelease[]> {
  const albums = await getDeezerAlbums(artistName);
  return albums.map((a) => ({
    release_key: buildKey(a.title, a.release_date),
    source: "deezer" as const,
    album_title: a.title,
    release_date: a.release_date ?? null,
    external_id: String(a.id),
  }));
}

/**
 * Aggregate the artist's releases across MB and Deezer.
 * Dedupes by (normalized title + release year-month). MB is preferred when
 * the same key surfaces from multiple sources.
 */
export async function aggregateArtistReleases(
  artistMbid: string,
  artistName: string
): Promise<AggregatedRelease[]> {
  const [mb, deezer] = await Promise.all([
    fetchFromMusicBrainz(artistMbid),
    fetchFromDeezer(artistName),
  ]);

  const sourceOrder: ReleaseSource[] = ["musicbrainz", "deezer"];
  const combined = [...mb, ...deezer];

  const byKey = new Map<string, AggregatedRelease>();
  for (const rel of combined) {
    if (!rel.release_key || rel.release_key === "|0000-00") continue;
    const existing = byKey.get(rel.release_key);
    if (!existing) {
      byKey.set(rel.release_key, rel);
      continue;
    }
    const existingRank = sourceOrder.indexOf(existing.source);
    const newRank = sourceOrder.indexOf(rel.source);
    if (newRank < existingRank) {
      byKey.set(rel.release_key, rel);
    }
  }

  return Array.from(byKey.values());
}
