import { NOMINAL_TRACK_MS } from "./signalIngestion";
import {
  artistRollupsByName,
  rollupWindowToArtists,
  type ListeningWindow,
  type WindowedPlay,
} from "./listeningWindow";
import { isPlaceholderArtist } from "../../utils/artistFilter";
import type { PlexRatingPayload } from "./signalIngestion";

/**
 * One artist's listening over the window, with how it spread across their tracks. The
 * rollup and the weight are one node rather than two: the same pass produces both, and
 * deriving them separately is what let the weight be measured from one series while the
 * spread that scales it was measured from another.
 *
 * `weight` is in play-equivalents — one play of a nominal-length track is `1`, one play of a
 * 90-minute set is ~26 — so a threshold in plays keeps its meaning as the knob moves.
 */
export type ArtistListening = {
  name: string;
  weight: number;
  plays: number;
  listenedMs: number;
  /** Tracks with at least one play in the window. */
  distinctTracksPlayed: number;
  /** Share of the artist's listening time on their single most-listened track. */
  topTrackShare: number;
};

/**
 * What the ratings say about one artist, joined onto the listening those ratings cover.
 *
 * `rating` is a play-weighted mean on Plex's 0–10 scale: each rated item counts for
 * `1 + plays`, so a star on the track carrying the artist's listening outweighs one on a
 * deep cut, while an unplayed rated item still counts once — a rating is a deliberate act,
 * not a by-product of listening.
 *
 * `breadth` is how many separate things the user has rated by this artist, as `1 - 1/rated`:
 * `0` for one, `0.5` for two, approaching `1` as the stars spread. It exists to refute the
 * one-hit read — starring only the track on repeat refutes nothing, starring the catalogue
 * refutes it — and reads the ratings alone, so it needs no answer to "which track is this
 * artist's top one" and the join to the spread disappears with it.
 */
export type ArtistRating = {
  rating: number;
  breadth: number;
};

/** An artist's effective weight, and the terms that produced it. */
export type ArtistWeight = {
  name: string;
  weight: number;
  plays: number;
  distinctTracksPlayed: number;
  topTrackShare: number;
  concentration: number;
  distributionFactor: number;
  breadth?: number;
  rating?: number;
  ratingMultiplier?: number;
};

export type WeightAdjustOptions = {
  /** `0` disables the one-hit discount outright. */
  distributionWeight: number;
  /** Plays below which concentration is noise rather than evidence. */
  minPlays: number;
  ratingWeight: number;
};

type RatingTotals = { weighted: number; weight: number; rated: number };

/** Album key → the listening its tracks hold, so an album rating joins onto plays. */
function albumPlaysByKey(
  plays: Map<string, WindowedPlay>
): Map<string, { artistName: string; plays: number }> {
  const albums = new Map<string, { artistName: string; plays: number }>();

  for (const row of plays.values()) {
    if (!row.albumKey) continue;
    const existing = albums.get(row.albumKey);
    if (!existing) {
      albums.set(row.albumKey, {
        artistName: row.artistName,
        plays: row.plays,
      });
      continue;
    }
    existing.plays += row.plays;
    if (!existing.artistName) existing.artistName = row.artistName;
  }
  return albums;
}

/**
 * Plays and listening traded off against each other by `listeningWeight`: `0` ranks on play
 * count, so twenty plays of a short track outweigh one long set; `1` ranks on time, so the
 * set wins. Plays measure how often it was chosen again, time measures how much of the
 * listening it filled.
 */
export function toPlayEquivalents(
  plays: number,
  listenedMs: number,
  listeningWeight: number
): number {
  const exposure = listenedMs / NOMINAL_TRACK_MS;
  return plays * (1 - listeningWeight) + exposure * listeningWeight;
}

/**
 * Per-artist listening over the resolved window. Artists with no listening at all are
 * dropped; the test is on plays *or* time rather than on the weight, so moving
 * `listeningWeight` can never silently empty the set of an artist who was genuinely played.
 */
export function deriveArtistListening(
  window: ListeningWindow,
  listeningWeight: number
): ArtistListening[] {
  const byName = artistRollupsByName(rollupWindowToArtists(window.plays));
  const listening: ArtistListening[] = [];

  for (const [name, rollup] of byName) {
    if (isPlaceholderArtist(name)) continue;
    if (rollup.playCount <= 0 && rollup.listenedMs <= 0) continue;

    listening.push({
      name,
      weight: toPlayEquivalents(
        rollup.playCount,
        rollup.listenedMs,
        listeningWeight
      ),
      plays: rollup.playCount,
      listenedMs: rollup.listenedMs,
      distinctTracksPlayed: rollup.distinctTracksPlayed,
      topTrackShare:
        rollup.listenedMs > 0
          ? rollup.topTrackListenedMs / rollup.listenedMs
          : 0,
    });
  }
  return listening;
}

/**
 * Per-artist rating signal, from the latest rating known for each rated item. Items whose
 * latest rating is `0` (un-rated) are excluded, so a cleared star doesn't drag an artist's
 * mean down. A rated item the window holds no listening for still counts, at weight `1`,
 * falling back to the artist name its payload carries.
 */
export function deriveArtistRatings(
  ratings: Map<string, PlexRatingPayload>,
  window: ListeningWindow
): Map<string, ArtistRating> {
  const albums = albumPlaysByKey(window.plays);
  const totals = new Map<string, RatingTotals>();

  for (const payload of ratings.values()) {
    if (payload.rating <= 0) continue;

    const track =
      payload.kind === "track"
        ? window.plays.get(payload.ratingKey)
        : undefined;
    const album =
      payload.kind === "track" ? undefined : albums.get(payload.ratingKey);
    const artist = track?.artistName || album?.artistName || payload.artist;
    if (!artist) continue;

    const weight = 1 + (track?.plays ?? album?.plays ?? 0);
    const entry = totals.get(artist) ?? { weighted: 0, weight: 0, rated: 0 };
    entry.weighted += payload.rating * weight;
    entry.weight += weight;
    entry.rated += 1;
    totals.set(artist, entry);
  }

  const signals = new Map<string, ArtistRating>();
  for (const [name, { weighted, weight, rated }] of totals) {
    signals.set(name, { rating: weighted / weight, breadth: 1 - 1 / rated });
  }
  return signals;
}

/**
 * How concentrated an artist's listening is, measured against what spreading it evenly over
 * the tracks actually played would look like: `(share - 1/n) / (1 - 1/n)`.
 *
 * The raw share cannot answer this on its own. One track played is a share of `1` by
 * construction, so a raw share puts the *strongest* discount exactly where there is no
 * evidence — which is what the library-catalogue exemption used to patch, at the cost of a
 * capture, a node and a knob. Here `n = 1` has no baseline to beat and scores `0`, a small
 * catalogue scores weakly, and only real concentration across several played tracks scores
 * high. Below-average concentration clamps to `0` rather than becoming a bonus.
 */
export function concentrationOf(
  topTrackShare: number,
  distinctTracksPlayed: number
): number {
  if (distinctTracksPlayed <= 1) return 0;
  const expected = 1 / distinctTracksPlayed;
  return Math.max(0, (topTrackShare - expected) / (1 - expected));
}

/**
 * The artist's effective weight: listening, discounted for concentration, boosted by rating.
 * One node because the two terms are coupled by design and reading them as independent is
 * the mistake they were shaped to prevent — the discount is scaled by `(1 - breadth)`
 * precisely so that starring an artist argues against the one-hit read instead of pulling
 * the same direction whichever track was starred.
 *
 *   `weight × (1 - distributionWeight × concentration × (1 - breadth)) × (1 + ratingWeight × rating/10)`
 *
 * One song on repeat is a song the user likes; the same time spread over a catalogue is an
 * artist they like, and only the second should pull a whole tag set into the genre vector.
 * Artists below `minPlays` are left undiscounted — at a handful of plays concentration is
 * noise — and `distributionWeight` of `0` switches the discount off from settings.
 */
export function adjustArtistWeights(
  listening: ArtistListening[],
  ratings: Map<string, ArtistRating>,
  options: WeightAdjustOptions
): ArtistWeight[] {
  const { distributionWeight, minPlays, ratingWeight } = options;

  return listening.map((artist) => {
    const signal = ratings.get(artist.name);
    const discountable =
      distributionWeight > 0 &&
      artist.plays >= minPlays &&
      artist.listenedMs > 0;

    const concentration = discountable
      ? concentrationOf(artist.topTrackShare, artist.distinctTracksPlayed)
      : 0;
    const distributionFactor =
      1 - distributionWeight * concentration * (1 - (signal?.breadth ?? 0));
    const ratingMultiplier = signal
      ? 1 + ratingWeight * (signal.rating / 10)
      : 1;

    return {
      name: artist.name,
      weight: artist.weight * distributionFactor * ratingMultiplier,
      plays: artist.plays,
      distinctTracksPlayed: artist.distinctTracksPlayed,
      topTrackShare: artist.topTrackShare,
      concentration,
      distributionFactor,
      ...(signal
        ? {
            breadth: signal.breadth,
            rating: signal.rating,
            ratingMultiplier,
          }
        : {}),
    };
  });
}
