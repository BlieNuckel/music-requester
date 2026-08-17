import { resolveArtistByMbid } from "../../api/jambase/artists";
import { JambaseError } from "../../api/jambase/config";
import { isLiveEventsConfigured } from "../../api/jambase/config";
import {
  findUnresolvedFollowedArtists,
  setJambaseArtistId,
} from "../../db/liveEvents";
import { createLogger } from "../../logger";

export type ResolutionOutcome = {
  attempted: number;
  resolved: number;
  missing: number;
  failed: number;
};

const log = createLogger("live-resolution");

function isoNow(): string {
  return new Date().toISOString();
}

/**
 * Turn followed artists' MBIDs into JamBase artist ids, one call each, once.
 *
 * A definitive answer (found, or JamBase has never heard of them) is recorded
 * so the artist leaves the queue. A transient failure deliberately records
 * nothing, so the next run retries rather than burning the miss in permanently.
 */
export async function resolveFollowedArtists(
  limit: number
): Promise<ResolutionOutcome> {
  const outcome: ResolutionOutcome = {
    attempted: 0,
    resolved: 0,
    missing: 0,
    failed: 0,
  };

  if (!isLiveEventsConfigured()) return outcome;

  const pending = await findUnresolvedFollowedArtists(limit);
  if (pending.length === 0) return outcome;

  for (const artist of pending) {
    outcome.attempted += 1;
    try {
      const resolved = await resolveArtistByMbid(artist.artist_mbid);
      await setJambaseArtistId(
        artist.id,
        resolved?.jambaseArtistId ?? null,
        isoNow()
      );

      if (resolved) outcome.resolved += 1;
      else outcome.missing += 1;
    } catch (error) {
      outcome.failed += 1;
      const kind = error instanceof JambaseError ? error.kind : "unknown";
      log.warn(
        `Could not resolve ${artist.artist_name} (${artist.artist_mbid}): ${kind}`
      );
      // A plan gate or a dead key will fail identically for everyone else in
      // this batch, so stop rather than spending a call per artist to find out.
      if (
        error instanceof JambaseError &&
        (error.kind === "plan-gated" || error.kind === "unauthorized")
      ) {
        break;
      }
    }
  }

  log.info(
    `Resolution: ${outcome.resolved} resolved, ${outcome.missing} unknown to JamBase, ${outcome.failed} failed`
  );
  return outcome;
}
