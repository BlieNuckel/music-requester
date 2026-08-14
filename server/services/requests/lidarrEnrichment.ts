import { mockEnrichRequestsWithLidarr } from "../../dev/mockLidarrEnrichment";
import { lidarrGet } from "../../api/lidarr/get";
import type {
  LidarrPaginatedResponse,
  LidarrQueueItem,
  LidarrWantedRecord,
  LidarrHistoryRecord,
} from "../../api/lidarr/types";
import { buildIndexerMap } from "../lidarr/history";
import { buildLastEventMap } from "../lidarr/wanted";
import { LIDARR_STATUS_TTL_MS } from "../lidarr/cacheTtl";
import { createSnapshotCache } from "../../utils/snapshotCache";
import { createLogger } from "../../logger";

type LidarrLifecycleStatus = "downloading" | "wanted" | "imported";

export type LidarrLifecycleDetails = {
  status: LidarrLifecycleStatus | null;
  downloadProgress: number | null;
  quality: string | null;
  sourceIndexer: string | null;
  lastEvent: { eventType: number; date: string } | null;
  lidarrAlbumId: number | null;
};

type QueueEntry = {
  downloadProgress: number;
  quality: string;
};

type ImportedEntry = {
  sourceIndexer: string | null;
};

type WantedEntry = {
  lastEvent: { eventType: number; date: string } | null;
  lidarrAlbumId: number;
};

type LidarrDataSnapshot = {
  queueMap: Map<string, QueueEntry>;
  importedMap: Map<string, ImportedEntry>;
  wantedMap: Map<string, WantedEntry>;
};

const log = createLogger("lidarr-enrichment");

export function buildQueueMap(
  queueItems: LidarrQueueItem[]
): Map<string, QueueEntry> {
  const map = new Map<string, QueueEntry>();
  for (const item of queueItems) {
    const mbid = item.album?.foreignAlbumId;
    if (!mbid) continue;
    const progress =
      item.size > 0
        ? Math.round(((item.size - item.sizeleft) / item.size) * 100)
        : 0;
    map.set(mbid, {
      downloadProgress: progress,
      quality: item.quality?.quality?.name ?? "Unknown",
    });
  }
  return map;
}

export function buildImportedMap(
  importedRecords: LidarrHistoryRecord[],
  grabbedRecords: LidarrHistoryRecord[]
): Map<string, ImportedEntry> {
  const indexerMap = buildIndexerMap(grabbedRecords);
  const map = new Map<string, ImportedEntry>();
  for (const record of importedRecords) {
    const mbid = record.album?.foreignAlbumId;
    if (!mbid || map.has(mbid)) continue;
    map.set(mbid, {
      sourceIndexer: indexerMap.get(record.downloadId) ?? null,
    });
  }
  return map;
}

export function buildWantedMap(
  wantedRecords: LidarrWantedRecord[],
  lastEventMap: Map<number, { eventType: number; date: string }>
): Map<string, WantedEntry> {
  const map = new Map<string, WantedEntry>();
  for (const record of wantedRecords) {
    if (map.has(record.foreignAlbumId)) continue;
    map.set(record.foreignAlbumId, {
      lastEvent: lastEventMap.get(record.id) ?? null,
      lidarrAlbumId: record.id,
    });
  }
  return map;
}

export function classifyRequest(
  mbid: string,
  queueMap: Map<string, QueueEntry>,
  importedMap: Map<string, ImportedEntry>,
  wantedMap: Map<string, WantedEntry>
): LidarrLifecycleDetails {
  const queueEntry = queueMap.get(mbid);
  if (queueEntry) {
    return {
      status: "downloading",
      downloadProgress: queueEntry.downloadProgress,
      quality: queueEntry.quality,
      sourceIndexer: null,
      lastEvent: null,
      lidarrAlbumId: null,
    };
  }

  const importedEntry = importedMap.get(mbid);
  if (importedEntry) {
    return {
      status: "imported",
      downloadProgress: null,
      quality: null,
      sourceIndexer: importedEntry.sourceIndexer,
      lastEvent: null,
      lidarrAlbumId: null,
    };
  }

  const wantedEntry = wantedMap.get(mbid);
  if (wantedEntry) {
    return {
      status: "wanted",
      downloadProgress: null,
      quality: null,
      sourceIndexer: null,
      lastEvent: wantedEntry.lastEvent,
      lidarrAlbumId: wantedEntry.lidarrAlbumId,
    };
  }

  return {
    status: null,
    downloadProgress: null,
    quality: null,
    sourceIndexer: null,
    lastEvent: null,
    lidarrAlbumId: null,
  };
}

async function loadLidarrData(): Promise<LidarrDataSnapshot> {
  const historyBaseQuery = {
    pageSize: 200,
    sortKey: "date",
    sortDirection: "descending",
    includeAlbum: true,
    includeArtist: true,
  };

  const [
    queueResult,
    wantedResult,
    importedResult,
    grabbedResult,
    historyForEventsResult,
  ] = await Promise.all([
    lidarrGet<LidarrPaginatedResponse<LidarrQueueItem>>("/queue", {
      page: 1,
      pageSize: 200,
      includeArtist: true,
      includeAlbum: true,
    }),
    lidarrGet<LidarrPaginatedResponse<LidarrWantedRecord>>("/wanted/missing", {
      page: 1,
      pageSize: 200,
      includeArtist: true,
      sortKey: "title",
      sortDirection: "ascending",
    }),
    lidarrGet<LidarrPaginatedResponse<LidarrHistoryRecord>>("/history", {
      ...historyBaseQuery,
      eventType: 3,
    }),
    lidarrGet<LidarrPaginatedResponse<LidarrHistoryRecord>>("/history", {
      ...historyBaseQuery,
      eventType: 1,
    }).catch(() => null),
    lidarrGet<LidarrPaginatedResponse<LidarrHistoryRecord>>("/history", {
      pageSize: 200,
      sortKey: "date",
      sortDirection: "descending",
      includeAlbum: true,
    }).catch(() => null),
  ]);

  const queueMap = buildQueueMap(queueResult.data.records);
  const importedMap = buildImportedMap(
    importedResult.data.records,
    grabbedResult?.data?.records ?? []
  );
  const lastEventMap = buildLastEventMap(
    historyForEventsResult?.data?.records ?? []
  );
  const wantedMap = buildWantedMap(wantedResult.data.records, lastEventMap);

  return { queueMap, importedMap, wantedMap };
}

const snapshot = createSnapshotCache({
  load: loadLidarrData,
  ttlMs: LIDARR_STATUS_TTL_MS,
});

/**
 * The queue/wanted/history snapshot behind every lifecycle status. Five
 * paginated Lidarr calls, so it is shared across the requests list, the
 * Discover shelf and the status poller rather than refetched per caller.
 * Callers must treat the returned maps as read-only — they are shared.
 */
export function fetchLidarrData(): Promise<LidarrDataSnapshot> {
  return snapshot.get();
}

/** Reload the snapshot regardless of age, leaving it warm for interactive reads. */
export function refreshLidarrData(): Promise<LidarrDataSnapshot> {
  return snapshot.refresh();
}

export function invalidateLidarrData(): void {
  snapshot.invalidate();
}

export async function enrichRequestsWithLidarr(
  albumMbids: string[]
): Promise<(LidarrLifecycleDetails | null)[]> {
  if (process.env.MOCK_LIDARR === "true") {
    return mockEnrichRequestsWithLidarr(albumMbids);
  }

  try {
    const { queueMap, importedMap, wantedMap } = await fetchLidarrData();
    return albumMbids.map((mbid) =>
      classifyRequest(mbid, queueMap, importedMap, wantedMap)
    );
  } catch (err) {
    log.warn(`Failed to enrich requests with Lidarr data: ${err}`);
    return albumMbids.map(() => null);
  }
}
