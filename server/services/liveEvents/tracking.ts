import {
  findArtistResolution,
  listArtistResolutions,
} from "../../db/liveEvents";
import type { ArtistResolutionSummary } from "../../db/liveEvents";

/**
 * Whether live coverage for an artist is coming, working, or never going to
 * happen. Derived rather than stored, because the two columns it comes from are
 * already the truth:
 *
 * - `pending` — not attempted yet. Resolution is capped per tick, so a large
 *   roster takes several sweeps.
 * - `tracked` — resolved to a JamBase id. An empty date list is a real answer.
 * - `unavailable` — attempted and JamBase has never heard of them. Recorded so
 *   the artist is never retried, which makes an empty list permanent.
 */
export type LiveTrackingState = "pending" | "tracked" | "unavailable";

export type LiveTrackingCounts = Record<LiveTrackingState, number>;

/** The two nullable columns, as one of the three states above. */
export function deriveLiveTracking(row: {
  jambase_artist_id: string | null;
  jambase_resolved_at: string | null;
}): LiveTrackingState {
  if (row.jambase_artist_id) return "tracked";
  return row.jambase_resolved_at ? "unavailable" : "pending";
}

/**
 * Tracking state for an MBID, or null when nobody follows the artist. Deliberately
 * not per-user: resolution is a fact about the artist, and one user's follow is
 * what resolves it for everyone.
 */
export async function getArtistLiveTracking(
  artistMbid: string
): Promise<LiveTrackingState | null> {
  const summary = await findArtistResolution(artistMbid);
  return summary.follows === 0 ? null : deriveLiveTracking(summary);
}

function tally(
  counts: LiveTrackingCounts,
  summary: ArtistResolutionSummary
): LiveTrackingCounts {
  counts[deriveLiveTracking(summary)] += 1;
  return counts;
}

/** Distinct followed artists per state, for the admin roster summary. */
export async function countLiveTracking(): Promise<LiveTrackingCounts> {
  const resolutions = await listArtistResolutions();
  return resolutions.reduce(tally, { pending: 0, tracked: 0, unavailable: 0 });
}
