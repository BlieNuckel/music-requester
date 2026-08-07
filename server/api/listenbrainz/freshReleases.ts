import { resilientFetch } from "../resilientFetch";
import { LISTENBRAINZ_API_BASE } from "./config";
import type { ListenBrainzFreshRelease } from "./types";

type FreshReleasesResponse = {
  payload?: {
    releases?: RawFreshRelease[];
  };
};

type RawFreshRelease = {
  artist_credit_name?: string;
  artist_mbids?: string[];
  release_name?: string;
  release_date?: string;
  release_group_mbid?: string;
  release_group_primary_type?: string | null;
  release_group_secondary_type?: string | null;
};

export const MAX_FRESH_RELEASES_DAYS = 90;

/**
 * Fetch the sitewide fresh-releases feed. One request covers every artist —
 * callers intersect the result against their own artist MBID sets instead of
 * polling per artist. Returns an empty array on any failure (best-effort).
 */
export async function getFreshReleases(
  days: number = MAX_FRESH_RELEASES_DAYS
): Promise<ListenBrainzFreshRelease[]> {
  const clamped = Math.min(
    Math.max(Math.trunc(days), 1),
    MAX_FRESH_RELEASES_DAYS
  );
  const url = `${LISTENBRAINZ_API_BASE}/1/explore/fresh-releases/?days=${clamped}`;

  try {
    const response = await resilientFetch(url);
    if (!response.ok) return [];

    const data = (await response.json()) as FreshReleasesResponse;
    const releases = data.payload?.releases;
    if (!Array.isArray(releases)) return [];

    return releases
      .filter(
        (r) =>
          typeof r.release_group_mbid === "string" &&
          typeof r.release_name === "string" &&
          Array.isArray(r.artist_mbids) &&
          r.artist_mbids.length > 0
      )
      .map((r) => ({
        artistName: r.artist_credit_name ?? "Unknown Artist",
        artistMbids: r.artist_mbids as string[],
        releaseName: r.release_name as string,
        releaseDate: r.release_date ?? null,
        releaseGroupMbid: r.release_group_mbid as string,
        primaryType: r.release_group_primary_type ?? null,
        secondaryType: r.release_group_secondary_type ?? null,
      }));
  } catch {
    return [];
  }
}
