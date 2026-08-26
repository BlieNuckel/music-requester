import { getSignalEvents } from "../../db/userProfile";
import { loadEpisodeSeries } from "./listenSessions";
import {
  ingestUserTrackPlays,
  latestRatings,
  reconstructAlbumTrackCounts,
  reconstructTrackPlayCounts,
} from "./signalIngestion";
import type { ListenEpisode } from "./listenHistory";
import type { PlexRatingPayload, TrackPlayState } from "./signalIngestion";
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
 * `tracks` carries the per-play ceiling the window measures under, because the window's
 * own all-time fallback reads this very map. Consumers that only count plays are unaffected
 * by it either way.
 */
export type FoldedSignals = {
  /**
   * The cumulative play fold, not a windowed measurement: no per-play ceiling has been
   * applied, because a ceiling belongs to the window that measures against it. Anything
   * wanting rows asks {@link listeningRows} for them under the cap it is measuring with.
   */
  tracks: Map<string, TrackPlayState>;
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

/**
 * Replay the log into current state, once, for everything that reads it as it stands.
 *
 * Takes no listening cap. It used to, and a caller holding `maxTrackMinutesForWeight` for
 * the window while taking a default here produced an uncapped total scaled by a capped
 * ratio — a mismatch nothing downstream could see. Folding and measuring are now separate
 * steps, so there is only one place left to state a ceiling and no second one to disagree
 * with it.
 */
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
    tracks: reconstructTrackPlayCounts(signals.trackEvents, Infinity),
    ratings: latestRatings(signals.ratingEvents),
    albumGenres,
  };
}
