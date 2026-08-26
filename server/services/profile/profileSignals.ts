import { getSignalEvents } from "../../db/userProfile";
import { allTimeListening } from "./listeningWindow";
import { loadEpisodeSeries } from "./listenSessions";
import {
  ingestUserTrackPlays,
  latestRatings,
  reconstructAlbumTrackCounts,
} from "./signalIngestion";
import type { ListenEpisode } from "./listenHistory";
import type { WindowedPlay } from "./listeningWindow";
import type { PlexRatingPayload } from "./signalIngestion";
import type { UserSignalEvent } from "../../db/entity/UserSignalEvent";

/**
 * The raw series a profile build reads, loaded once. Kept raw because two derivations fold
 * at a cutoff other than "now" and cannot work from folded state: the window folds at its
 * own start, and the listening series folds at every bucket boundary.
 */
export type ProfileSignals = {
  trackEvents: UserSignalEvent[];
  ratingEvents: UserSignalEvent[];
  albumEvents: UserSignalEvent[];
  episodes: Map<string, ListenEpisode>;
};

/**
 * The same series replayed to their current state, folded once for the derivations that only
 * ever want "as it stands now". Before this the log was re-folded per consumer — the track
 * series alone was replayed about five times per rebuild — because the loader was named for
 * a fold it never performed.
 *
 * `tracks` is uncapped on purpose: the per-play ceiling exists to stop one long play
 * dominating a *window*, and nothing reading all-time state is measuring listening time.
 */
export type FoldedSignals = {
  tracks: Map<string, WindowedPlay>;
  ratings: Map<string, PlexRatingPayload>;
  /** Plex's own agent genres per album key, for albums Last.fm has nothing on. */
  albumGenres: Map<string, string[]>;
};

/**
 * Every series one profile build reads, fetched concurrently — they are independent tables
 * and awaiting them in sequence made a rebuild wait four times for no reason.
 *
 * A user with no play captures at all has one ingested on demand, so even the first read
 * goes through our own log rather than reaching for Plex mid-derivation.
 */
export async function loadProfileSignals(
  userId: number,
  plexToken: string
): Promise<ProfileSignals> {
  const [trackEvents, ratingEvents, albumEvents, episodes] = await Promise.all([
    getSignalEvents(userId, "plex_track_plays"),
    getSignalEvents(userId, "plex_rating"),
    getSignalEvents(userId, "plex_album_tracks"),
    loadEpisodeSeries(userId),
  ]);

  if (trackEvents.length > 0) {
    return { trackEvents, ratingEvents, albumEvents, episodes };
  }

  await ingestUserTrackPlays(userId, plexToken);
  return {
    trackEvents: await getSignalEvents(userId, "plex_track_plays"),
    ratingEvents,
    albumEvents,
    episodes,
  };
}

/** Replay the log into current state, once, for everything that reads it as it stands. */
export function foldSignalsToNow(signals: ProfileSignals): FoldedSignals {
  const albumGenres = new Map<string, string[]>();
  for (const [key, album] of reconstructAlbumTrackCounts(
    signals.albumEvents,
    Infinity
  )) {
    if (album.genres && album.genres.length > 0) {
      albumGenres.set(key, album.genres);
    }
  }

  return {
    tracks: allTimeListening(signals.trackEvents),
    ratings: latestRatings(signals.ratingEvents),
    albumGenres,
  };
}
