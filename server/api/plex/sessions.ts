import { resilientFetch } from "../resilientFetch";
import { getPlexConfig } from "./config";
import type { PlexSessionMetadata, PlexSessionsResponse } from "./types";

/** One track currently loaded on a client, as `/status/sessions` reports it. */
export type PlexTrackSession = {
  sessionKey: string;
  ratingKey: string;
  title: string;
  artistKey: string;
  artistName: string;
  albumKey: string;
  albumTitle: string;
  durationMs: number;
  /** Playback position in milliseconds — the only trustworthy evidence that audio moved. */
  viewOffsetMs: number;
  machineIdentifier: string;
  product: string;
  /** Plex's own claim about playback, kept for diagnostics; it is not always right. */
  state: string;
};

const isTrack = (raw: PlexSessionMetadata): boolean =>
  raw.type === "track" &&
  Boolean(raw.sessionKey) &&
  Boolean(raw.ratingKey) &&
  typeof raw.viewOffset === "number";

const mapSession = (raw: PlexSessionMetadata): PlexTrackSession => ({
  sessionKey: raw.sessionKey ?? "",
  ratingKey: raw.ratingKey ?? "",
  title: raw.title ?? "",
  artistKey: raw.grandparentRatingKey ?? "",
  artistName: raw.grandparentTitle ?? "",
  albumKey: raw.parentRatingKey ?? "",
  albumTitle: raw.parentTitle ?? "",
  durationMs: raw.duration ?? 0,
  viewOffsetMs: raw.viewOffset ?? 0,
  machineIdentifier: raw.Player?.machineIdentifier ?? "",
  product: raw.Player?.product ?? "",
  state: raw.Player?.state ?? "",
});

/**
 * Every music track currently loaded on one of the token holder's clients.
 *
 * Scopes to the token's own account, so this sees less than the PMS dashboard does — the
 * dashboard runs as owner. Cached or offline Plexamp playback produces no session at all
 * while still committing a play later, so an empty read is not evidence of no listening.
 */
export async function getActiveSessions(
  plexToken: string
): Promise<PlexTrackSession[]> {
  const { baseUrl, headers } = getPlexConfig(plexToken);
  const res = await resilientFetch(`${baseUrl}/status/sessions`, { headers });
  if (!res.ok) throw new Error(`Plex returned ${res.status}`);

  const data: PlexSessionsResponse = await res.json();
  return (data.MediaContainer?.Metadata ?? []).filter(isTrack).map(mapSession);
}
