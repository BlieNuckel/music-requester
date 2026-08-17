import { jambaseGet } from "./fetch";
import { JambaseError } from "./config";
import { normalizeEvents } from "./normalize";
import type { SweptEvent } from "../../db/liveEvents";
import type { JambaseArtistResponse } from "./types";

export type ResolvedArtist = {
  jambaseArtistId: string;
  name: string;
  genres: string[];
  numUpcomingEvents: number | null;
  events: SweptEvent[];
};

/**
 * Resolve a MusicBrainz id to a JamBase artist.
 *
 * Reverse lookup by external identifier works on every plan; it is
 * `expandExternalIdentifiers` (getting foreign ids back out) that is plan-gated.
 * That asymmetry is what lets the whole feature key off MBIDs without paying.
 *
 * @returns null when JamBase has no artist for this MBID, which is a real answer
 * and should be recorded so it is not asked again every sweep.
 */
export async function resolveArtistByMbid(
  mbid: string,
  options: { withEvents?: boolean } = {}
): Promise<ResolvedArtist | null> {
  let response: JambaseArtistResponse;
  try {
    response = await jambaseGet<JambaseArtistResponse>(
      `/artists/id/musicbrainz:${encodeURIComponent(mbid)}`,
      options.withEvents ? { expandUpcomingEvents: "true" } : {}
    );
  } catch (error) {
    if (error instanceof JambaseError && error.kind === "not-found")
      return null;
    throw error;
  }

  const artist = response.artist;
  if (!artist?.identifier) return null;

  return {
    jambaseArtistId: artist.identifier,
    name: artist.name ?? "Unknown artist",
    genres: artist.genre ?? [],
    numUpcomingEvents: artist["x-numUpcomingEvents"] ?? null,
    events: normalizeEvents(artist.events).events,
  };
}
