import { MB_BASE, mbJson } from "./config";
import { mbCached, MB_TTL } from "./cache";
import type { MbPriority } from "./queue";
import type { MusicBrainzReleasesResponse, TrackMedia } from "./types";

async function loadReleaseTracks(
  releaseGroupId: string,
  priority: MbPriority
): Promise<TrackMedia[]> {
  const url = `${MB_BASE}/release?release-group=${releaseGroupId}&inc=recordings+media&limit=1&fmt=json`;
  const data = await mbJson<MusicBrainzReleasesResponse>(url, priority);

  const release = data?.releases?.[0];
  if (!release) {
    return [];
  }

  return (release.media || []).map((m) => ({
    position: m.position,
    format: m.format || "",
    title: m.title || "",
    tracks: (m.tracks || []).map((t) => ({
      position: t.position,
      title: t.recording?.title || t.title,
      length: t.length,
    })),
  }));
}

/** Fetch the track listing for a release group */
export function getReleaseTracks(
  releaseGroupId: string,
  priority: MbPriority = "interactive"
): Promise<TrackMedia[]> {
  return mbCached(
    {
      key: `rg-tracks:${releaseGroupId}`,
      ttlSeconds: MB_TTL.immutable,
      priority,
    },
    (p) => loadReleaseTracks(releaseGroupId, p)
  );
}
