import { getSignalEvents } from "../db/userProfile";
import {
  reconstructTrackPlayCounts,
  rollupToAlbums,
} from "../services/profile/signalIngestion";
import { normalizeAlbumKey } from "../utils/albumKey";

/**
 * Plays an album needs before it counts as one the user already knows. A stray play or two
 * is what discovery looks like from the inside; this is the line past which recommending
 * the album back to them says nothing they don't already have.
 */
const KNOWN_ALBUM_MIN_PLAYS = 5;

/** Cap on stored keys, so a huge library can't turn the profile document into a payload. */
const KNOWN_ALBUM_LIMIT = 500;

/**
 * The albums this user has actually listened through, as normalized keys, most-played first.
 * Built at profile-regeneration time from the same track series the weights come from — this
 * is the first consumer of {@link rollupToAlbums} — and used to keep recommendations off
 * records the user already plays.
 */
export async function loadKnownAlbums(userId: number): Promise<string[]> {
  const events = await getSignalEvents(userId, "plex_track_plays");
  const albums = rollupToAlbums(reconstructTrackPlayCounts(events, Infinity));

  return albums
    .filter((a) => a.playCount >= KNOWN_ALBUM_MIN_PLAYS && a.title)
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, KNOWN_ALBUM_LIMIT)
    .map((a) => normalizeAlbumKey(a.artistName, a.title));
}
