import type { TrackedDownload } from "./types";

const downloads = new Map<string, TrackedDownload>();

/**
 * How long a tracked download survives without Lidarr cleaning it up.
 *
 * Entries are normally removed when Lidarr deletes them from its queue or history.
 * Nothing guarantees it ever does: a transfer that ends Failed, or one Lidarr loses
 * track of, is never deleted, and `getAllDownloads` would keep handing it back on
 * every history poll for the life of the process. Anything this old is finished as
 * far as Lidarr is concerned.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function pruneStale(now: number): void {
  for (const [nzoId, download] of downloads) {
    if (now - download.addedAt > MAX_AGE_MS) downloads.delete(nzoId);
  }
}

export function addDownload(download: TrackedDownload): void {
  pruneStale(download.addedAt);
  downloads.set(download.nzoId, download);
}

export function getDownload(nzoId: string): TrackedDownload | undefined {
  return downloads.get(nzoId);
}

export function getAllDownloads(now = Date.now()): TrackedDownload[] {
  pruneStale(now);
  return Array.from(downloads.values());
}

export function removeDownload(nzoId: string): boolean {
  return downloads.delete(nzoId);
}

export function clearDownloads(): void {
  downloads.clear();
}
