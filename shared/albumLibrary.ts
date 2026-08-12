/**
 * An album row existing in Lidarr only means it is monitored — it says nothing
 * about whether the files were ever found and downloaded. These helpers turn
 * Lidarr's track statistics into the three states the UI distinguishes.
 */
export type AlbumLibraryState = "complete" | "partial" | "requested";

export type AlbumLibraryInfo = {
  state: AlbumLibraryState;
  available: number;
  total: number;
};

export type AlbumTrackStatistics = {
  trackFileCount: number;
  totalTrackCount: number;
};

export function deriveAlbumLibraryInfo(
  statistics?: AlbumTrackStatistics | null
): AlbumLibraryInfo {
  const available = statistics?.trackFileCount ?? 0;
  const total = statistics?.totalTrackCount ?? 0;

  if (available === 0) return { state: "requested", available, total };
  if (total === 0 || available >= total)
    return { state: "complete", available, total };
  return { state: "partial", available, total };
}

/** Short badge/pill text. */
export function albumLibraryLabel(info: AlbumLibraryInfo): string {
  if (info.state === "complete") return "In library";
  if (info.total === 0) return "Not downloaded";
  return `${info.available}/${info.total} tracks`;
}

/** Fuller phrasing for tooltips and screen readers. */
export function albumLibraryTitle(info: AlbumLibraryInfo): string {
  if (info.state === "complete") return "In library";
  if (info.state === "partial")
    return `Partially downloaded — ${info.available}/${info.total} tracks`;
  return "Requested, not downloaded";
}
