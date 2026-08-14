import { invalidateArtistList } from "./artists";
import { invalidateMonitoredAlbums } from "./albums";
import { invalidateLidarrData } from "../requests/lidarrEnrichment";

/**
 * Drops every cached Lidarr snapshot. Called after we write to Lidarr, so a
 * user who just added or removed something sees it on the next page load
 * instead of waiting out a TTL that only exists for changes made in Lidarr.
 */
export function invalidateLidarrCaches(): void {
  invalidateArtistList();
  invalidateMonitoredAlbums();
  invalidateLidarrData();
}
