import { fetchReleaseGroupsForArtist } from "../../api/musicbrainz/releaseGroups";
import { getArtistAlbumsByName as getDeezerAlbums } from "../../api/deezer/albums";
import { createLogger } from "../../logger";

/** Where a release surfaced during aggregation — used only for dedup ranking. */
type ReleaseSource = "musicbrainz" | "deezer";

export type AggregatedRelease = {
  release_key: string;
  source: ReleaseSource;
  album_title: string;
  release_date: string | null;
  release_group_mbid: string | null;
  cover_url: string | null;
  release_type: string | null;
  secondary_types: string[] | null;
};

const log = createLogger("releaseAggregator");

const TITLE_NOISE = /[\s.,!?'"()[\]{}\-_:;]+/g;

const DEEZER_RECORD_TYPE_MAP: Record<
  string,
  { release_type: string; secondary_types: string[] }
> = {
  album: { release_type: "Album", secondary_types: [] },
  ep: { release_type: "EP", secondary_types: [] },
  single: { release_type: "Single", secondary_types: [] },
  compilation: { release_type: "Album", secondary_types: ["Compilation"] },
};

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(TITLE_NOISE, "").trim();
}

function yearMonth(date: string | null | undefined): string {
  if (!date) return "0000-00";
  return date.slice(0, 7);
}

/** The dedup key shared by the poller pipeline and the discover blend. */
export function buildReleaseKey(
  title: string,
  date: string | null | undefined
): string {
  return `${normalizeTitle(title)}|${yearMonth(date)}`;
}

export function coverArtUrlForReleaseGroup(releaseGroupMbid: string): string {
  return `https://coverartarchive.org/release-group/${releaseGroupMbid}/front-500`;
}

async function fetchFromMusicBrainz(
  artistMbid: string
): Promise<AggregatedRelease[]> {
  try {
    const groups = await fetchReleaseGroupsForArtist(artistMbid, "background");
    return groups.map((rg) => ({
      release_key: buildReleaseKey(rg.title, rg["first-release-date"]),
      source: "musicbrainz" as const,
      album_title: rg.title,
      release_date: rg["first-release-date"] || null,
      release_group_mbid: rg.id,
      cover_url: coverArtUrlForReleaseGroup(rg.id),
      release_type: rg["primary-type"] || null,
      secondary_types: rg["secondary-types"] ?? [],
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
  return albums.map((a) => {
    const mapped = a.record_type
      ? DEEZER_RECORD_TYPE_MAP[a.record_type.toLowerCase()]
      : undefined;
    return {
      release_key: buildReleaseKey(a.title, a.release_date),
      source: "deezer" as const,
      album_title: a.title,
      release_date: a.release_date ?? null,
      release_group_mbid: null,
      cover_url: a.cover_xl ?? a.cover ?? null,
      release_type: mapped?.release_type ?? null,
      secondary_types: mapped?.secondary_types ?? null,
    };
  });
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
