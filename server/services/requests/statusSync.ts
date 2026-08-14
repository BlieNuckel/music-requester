import type { Request } from "../../db/index";
import type { LidarrLifecycleStatus } from "../../db/index";
import { findRequestsAwaitingStatus, saveRequests } from "../../db/requests";
import { refreshLidarrData, classifyRequest } from "./lidarrEnrichment";
import { mockEnrichRequestsWithLidarr } from "../../dev/mockLidarrEnrichment";
import { createLogger } from "../../logger";
import { notifyRequestStatus } from "../notifications";

const log = createLogger("request-status-sync");

const TERMINAL_STATUSES: LidarrLifecycleStatus[] = ["failed", "imported"];

async function resolveStatuses(
  albumMbids: string[]
): Promise<(LidarrLifecycleStatus | null)[]> {
  if (process.env.MOCK_LIDARR === "true") {
    const mocks = await mockEnrichRequestsWithLidarr(albumMbids);
    return mocks.map((m) => m?.status ?? null);
  }

  const { queueMap, importedMap, wantedMap } = await refreshLidarrData();
  return albumMbids.map(
    (mbid) => classifyRequest(mbid, queueMap, importedMap, wantedMap).status
  );
}

/**
 * Polls Lidarr once and persists the discrete lifecycle status onto approved
 * requests. `failed` and `imported` are treated as terminal and never
 * overwritten. A Lidarr fetch failure aborts the sync without writing, so
 * transient outages don't wipe existing statuses.
 */
export async function syncRequestStatuses(): Promise<void> {
  const candidates = await findRequestsAwaitingStatus(TERMINAL_STATUSES);

  if (candidates.length === 0) return;

  let statuses: (LidarrLifecycleStatus | null)[];
  try {
    statuses = await resolveStatuses(candidates.map((c) => c.album_mbid));
  } catch (err) {
    log.warn(`Skipping status sync; Lidarr fetch failed: ${err}`);
    return;
  }

  const changed: Request[] = [];
  candidates.forEach((request, i) => {
    const next = statuses[i] ?? null;
    if (request.lidarr_status !== next) {
      request.lidarr_status = next;
      changed.push(request);
    }
  });

  if (changed.length > 0) {
    await saveRequests(changed);
    log.info(`Updated lidarr_status for ${changed.length} request(s)`);
    // Only transitions reach here, so a poll that finds nothing new is silent.
    changed.forEach((request) => {
      void notifyRequestStatus(request, request.lidarr_status);
    });
  }
}
