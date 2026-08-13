import { MB_BASE, mbJson } from "./config";
import { mbCached, MB_TTL } from "./cache";
import { createLogger } from "../../logger";
import type { MbPriority } from "./queue";
import type {
  MusicBrainzReleaseGroup,
  MusicBrainzSearchResponse,
  ReleaseGroupSearchResult,
  MusicBrainzRelease,
  ReleaseGroupInfo,
  MusicBrainzLabelReleasesResponse,
} from "./types";

export type AlbumDetails = {
  mbid: string;
  title: string;
  artistName: string;
  artistMbid: string | null;
  firstReleaseDate: string | null;
  primaryType: string | null;
  secondaryTypes: string[];
};

type LabelResult = { name: string; mbid: string } | null;

const log = createLogger("musicbrainz");

async function loadReleaseGroupSearch(
  query: string,
  priority: MbPriority
): Promise<ReleaseGroupSearchResult> {
  const url = `${MB_BASE}/release-group/?query=${encodeURIComponent(query)}&limit=100&fmt=json`;
  const data = await mbJson<MusicBrainzSearchResponse>(url, priority);

  if (!data) {
    return { "release-groups": [], count: 0, offset: 0 };
  }

  const sorted = [...data["release-groups"]].sort((a, b) => b.score - a.score);

  return { ...data, "release-groups": sorted, count: sorted.length };
}

async function loadArtistReleaseGroups(
  artistId: string,
  priority: MbPriority
): Promise<MusicBrainzReleaseGroup[]> {
  const url = `${MB_BASE}/release-group?artist=${artistId}&type=album|ep|single&limit=100&inc=artist-credits&fmt=json`;
  const data = await mbJson<MusicBrainzSearchResponse>(url, priority);
  return data?.["release-groups"] ?? [];
}

async function loadReleaseGroupSummary(
  releaseGroupMbid: string,
  priority: MbPriority
): Promise<{ artistName: string; albumTitle: string } | null> {
  const url = `${MB_BASE}/release-group/${releaseGroupMbid}?inc=artist-credits&fmt=json`;
  const data = await mbJson<MusicBrainzReleaseGroup>(url, priority);
  if (!data) return null;

  return {
    artistName: data["artist-credit"]?.[0]?.name ?? "Unknown Artist",
    albumTitle: data.title ?? "Unknown Album",
  };
}

async function loadAlbumDetails(
  releaseGroupMbid: string,
  priority: MbPriority
): Promise<AlbumDetails | null> {
  const url = `${MB_BASE}/release-group/${releaseGroupMbid}?inc=artist-credits&fmt=json`;
  const data = await mbJson<MusicBrainzReleaseGroup>(url, priority);
  if (!data) return null;

  const credit = data["artist-credit"]?.[0];

  return {
    mbid: data.id,
    title: data.title ?? "Unknown Album",
    artistName: credit?.name ?? "Unknown Artist",
    artistMbid: credit?.artist?.id ?? null,
    firstReleaseDate: data["first-release-date"] || null,
    primaryType: data["primary-type"] || null,
    secondaryTypes: data["secondary-types"] ?? [],
  };
}

async function loadReleaseGroupLabel(
  releaseGroupMbid: string,
  priority: MbPriority
): Promise<LabelResult> {
  const url = `${MB_BASE}/release?release-group=${releaseGroupMbid}&inc=labels&limit=1&fmt=json`;
  const data = await mbJson<MusicBrainzLabelReleasesResponse>(url, priority);

  const labelInfo = data?.releases?.[0]?.["label-info"];
  if (!labelInfo || labelInfo.length === 0) return null;

  const label = labelInfo[0].label;
  if (!label?.name || !label?.id) return null;

  return { name: label.name, mbid: label.id };
}

async function loadReleaseGroupDate(
  releaseGroupMbid: string,
  priority: MbPriority
): Promise<string | null> {
  const url = `${MB_BASE}/release-group/${releaseGroupMbid}?fmt=json`;
  const data = await mbJson<{ "first-release-date"?: string }>(url, priority);
  return data?.["first-release-date"] || null;
}

async function loadReleaseGroupIdFromRelease(
  releaseMbid: string,
  priority: MbPriority
): Promise<ReleaseGroupInfo | null> {
  const url = `${MB_BASE}/release/${releaseMbid}?inc=release-groups&fmt=json`;
  const data = await mbJson<MusicBrainzRelease>(url, priority);

  const rg = data?.["release-group"];
  if (!rg?.id) return null;

  return {
    id: rg.id,
    firstReleaseDate: rg["first-release-date"] ?? "",
    primaryType: rg["primary-type"] ?? null,
    secondaryTypes: rg["secondary-types"] ?? [],
  };
}

async function loadReleaseGroupInfo(
  releaseGroupMbid: string,
  priority: MbPriority
): Promise<ReleaseGroupInfo | null> {
  const url = `${MB_BASE}/release-group/${releaseGroupMbid}?fmt=json`;
  const data = await mbJson<MusicBrainzReleaseGroup>(url, priority);
  if (!data?.id) return null;

  return {
    id: data.id,
    firstReleaseDate: data["first-release-date"] ?? "",
    primaryType: data["primary-type"] ?? null,
    secondaryTypes: data["secondary-types"] ?? [],
  };
}

/** Search for release groups (albums/EPs) by text query */
export function searchReleaseGroups(
  query: string,
  priority: MbPriority = "interactive"
): Promise<ReleaseGroupSearchResult> {
  return mbCached(
    {
      key: `rg-search:${query.toLowerCase()}`,
      ttlSeconds: MB_TTL.volatile,
      priority,
      strategy: "revalidate",
    },
    (p) => loadReleaseGroupSearch(query, p)
  );
}

/** Fetch all release groups (albums/EPs/singles) for a single artist MBID */
export function fetchReleaseGroupsForArtist(
  artistId: string,
  priority: MbPriority = "interactive"
): Promise<MusicBrainzReleaseGroup[]> {
  return mbCached(
    {
      key: `artist-rgs:${artistId}`,
      ttlSeconds: MB_TTL.volatile,
      priority,
      strategy: "revalidate",
    },
    (p) => loadArtistReleaseGroups(artistId, p)
  );
}

/** Look up a release group by its MBID, returning title and artist credit */
export function getReleaseGroupById(
  releaseGroupMbid: string,
  priority: MbPriority = "interactive"
): Promise<{ artistName: string; albumTitle: string } | null> {
  return mbCached(
    {
      key: `rg-summary:${releaseGroupMbid}`,
      ttlSeconds: MB_TTL.immutable,
      priority,
    },
    (p) => loadReleaseGroupSummary(releaseGroupMbid, p)
  );
}

/** Fetch album metadata for a release group, including artist MBID and type */
export function getAlbumDetails(
  releaseGroupMbid: string,
  priority: MbPriority = "interactive"
): Promise<AlbumDetails | null> {
  return mbCached(
    {
      key: `album:${releaseGroupMbid}`,
      ttlSeconds: MB_TTL.immutable,
      priority,
    },
    (p) => loadAlbumDetails(releaseGroupMbid, p)
  );
}

/** Fetch the primary label for a release group */
export function getReleaseGroupLabel(
  releaseGroupMbid: string,
  priority: MbPriority = "interactive"
): Promise<LabelResult> {
  return mbCached(
    {
      key: `rg-label:${releaseGroupMbid}`,
      ttlSeconds: MB_TTL.immutable,
      priority,
    },
    (p) => loadReleaseGroupLabel(releaseGroupMbid, p)
  );
}

/** Fetch the first-release-date for a release group */
export function getReleaseGroupDate(
  releaseGroupMbid: string,
  priority: MbPriority = "interactive"
): Promise<string | null> {
  return mbCached(
    {
      key: `rg-date:${releaseGroupMbid}`,
      ttlSeconds: MB_TTL.immutable,
      priority,
    },
    (p) => loadReleaseGroupDate(releaseGroupMbid, p)
  );
}

/** Convert a release MBID to its release-group ID, first release date and types */
export function getReleaseGroupIdFromRelease(
  releaseMbid: string,
  priority: MbPriority = "interactive"
): Promise<ReleaseGroupInfo | null> {
  return mbCached(
    {
      key: `release-rg:${releaseMbid}`,
      ttlSeconds: MB_TTL.immutable,
      priority,
    },
    (p) => loadReleaseGroupIdFromRelease(releaseMbid, p)
  );
}

/** Read a release group directly by its own MBID */
export function getReleaseGroupInfo(
  releaseGroupMbid: string,
  priority: MbPriority = "interactive"
): Promise<ReleaseGroupInfo | null> {
  return mbCached(
    {
      key: `rg-info:${releaseGroupMbid}`,
      ttlSeconds: MB_TTL.immutable,
      priority,
    },
    (p) => loadReleaseGroupInfo(releaseGroupMbid, p)
  );
}

/**
 * Resolve an MBID of unknown kind to its release group. Last.fm is inconsistent about
 * whether `tag.getTopAlbums` hands back a release MBID or a release-group one, and the
 * release lookup 404s on the latter — a miss `mbCached` then stores for the whole TTL,
 * silently dropping that album from every candidate pool. So a miss retries the MBID as a
 * release group before giving up. Both legs are cached, so a repeat costs no MusicBrainz
 * slots; only a first-time already-a-release-group MBID spends the extra one.
 */
export async function resolveReleaseGroupInfo(
  mbid: string,
  priority: MbPriority = "interactive"
): Promise<ReleaseGroupInfo | null> {
  const fromRelease = await getReleaseGroupIdFromRelease(mbid, priority);
  if (fromRelease) return fromRelease;

  const asReleaseGroup = await getReleaseGroupInfo(mbid, priority);
  if (asReleaseGroup) {
    log.debug(`MBID ${mbid} was already a release group, not a release`);
  }
  return asReleaseGroup;
}
