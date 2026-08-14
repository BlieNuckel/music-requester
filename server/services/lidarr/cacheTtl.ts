/** How long a whole-library snapshot (artists, monitored albums) stays valid. */
export const LIBRARY_SNAPSHOT_TTL_MS = 5 * 60 * 1000;

/**
 * How long the queue/wanted/history snapshot stays valid. Short, because it
 * backs download progress and request status; the status poller refreshes it
 * on its own schedule, so most reads land on an already-warm entry.
 */
export const LIDARR_STATUS_TTL_MS = 30 * 1000;
