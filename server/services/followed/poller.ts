import {
  getAllFollowedArtists,
  findFollowedRelease,
  recordFollowedRelease,
  backfillReleaseMetadata,
  updateLastCheckedAt,
} from "./followedService";
import { aggregateArtistReleases } from "./releaseAggregator";
import { createLogger } from "../../logger";
import { notifyFollowedRelease } from "../notifications";
import type { AggregatedRelease } from "./releaseAggregator";
import type { FollowedArtist } from "../../db/index";

const log = createLogger("followed-poller");

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 30 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A notification is only worth sending for something that just came out. The
 * aggregator returns an artist's whole discography, so without this an old
 * release newly catalogued upstream would announce itself as new.
 */
const NOTIFY_WINDOW_DAYS = 30;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

function isoNow(): string {
  return new Date().toISOString();
}

function isFreshRelease(releaseDate: string | null, now: number): boolean {
  if (!releaseDate) return false;

  const released = Date.parse(releaseDate);
  if (Number.isNaN(released)) return false;

  return released <= now && now - released <= NOTIFY_WINDOW_DAYS * DAY_MS;
}

async function recordNewRelease(
  follow: FollowedArtist,
  rel: AggregatedRelease,
  isBackfill: boolean,
  now: number
): Promise<void> {
  await recordFollowedRelease({
    followed_artist_id: follow.id,
    release_key: rel.release_key,
    album_title: rel.album_title,
    release_date: rel.release_date,
    release_group_mbid: rel.release_group_mbid,
    cover_url: rel.cover_url,
    release_type: rel.release_type,
    secondary_types: rel.secondary_types,
  });

  // The first poll after following records the entire back catalogue; none of
  // it is news to the person who just chose to follow the artist.
  if (isBackfill || !isFreshRelease(rel.release_date, now)) return;

  void notifyFollowedRelease({
    userId: follow.user_id,
    artistName: follow.artist_name,
    artistMbid: follow.artist_mbid,
    albumTitle: rel.album_title,
    releaseGroupMbid: rel.release_group_mbid,
  });
}

async function pollOneArtist(follow: FollowedArtist): Promise<void> {
  const releases = await aggregateArtistReleases(
    follow.artist_mbid,
    follow.artist_name
  );

  const isBackfill = follow.last_checked_at === null;
  const now = Date.now();

  for (const rel of releases) {
    const existing = await findFollowedRelease(follow.id, rel.release_key);

    if (!existing) {
      await recordNewRelease(follow, rel, isBackfill, now);
      continue;
    }

    if (!existing.release_group_mbid && rel.release_group_mbid) {
      await backfillReleaseMetadata(existing.id, {
        release_group_mbid: rel.release_group_mbid,
        cover_url: rel.cover_url,
        release_type: rel.release_type,
        secondary_types: rel.secondary_types,
      });
    }
  }

  await updateLastCheckedAt(follow.id, isoNow());
}

export async function runPollOnce(): Promise<void> {
  if (running) {
    log.warn("Poll already running, skipping this tick");
    return;
  }
  running = true;
  try {
    const follows = await getAllFollowedArtists();
    log.info(`Polling ${follows.length} followed artist(s)`);
    for (const f of follows) {
      try {
        await pollOneArtist(f);
      } catch (error) {
        log.error(`Poll failed for artist ${f.artist_name} (${f.id})`, error);
      }
    }
  } finally {
    running = false;
  }
}

export function startFollowedArtistPoller(
  intervalMs: number = DEFAULT_INTERVAL_MS
): void {
  if (timer) return;

  const tick = async () => {
    try {
      await runPollOnce();
    } catch (error) {
      log.error("Poll tick failed", error);
    } finally {
      timer = setTimeout(tick, intervalMs);
    }
  };

  timer = setTimeout(tick, FIRST_RUN_DELAY_MS);
  log.info(
    `Followed artist poller scheduled (interval: ${intervalMs / 1000}s)`
  );
}

export function stopFollowedArtistPoller(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
