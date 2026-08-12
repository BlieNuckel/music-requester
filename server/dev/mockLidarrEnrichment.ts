import { In } from "typeorm";
import { getDataSource, Request } from "../db/index";
import { createLogger } from "../logger";
import type { LidarrLifecycleDetails } from "../services/requests/lidarrEnrichment";

type MockState = "downloading" | "wanted" | "imported" | null;

const log = createLogger("mock-lidarr");

const MOCK_STATES: MockState[] = [
  "downloading",
  "downloading",
  "wanted",
  "wanted",
  "imported",
  "imported",
  "imported",
  null,
];

function hashMbid(mbid: string): number {
  let hash = 0;
  for (let i = 0; i < mbid.length; i++) {
    hash = (hash * 31 + mbid.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function mockForMbid(mbid: string): LidarrLifecycleDetails {
  const hash = hashMbid(mbid);
  const state = MOCK_STATES[hash % MOCK_STATES.length];

  switch (state) {
    case "downloading":
      return {
        status: "downloading",
        downloadProgress: (hash % 91) + 5,
        quality: hash % 2 === 0 ? "FLAC" : "MP3-320",
        sourceIndexer: null,
        lastEvent: null,
        lidarrAlbumId: null,
      };

    case "wanted": {
      const eventVariants: LidarrLifecycleDetails["lastEvent"][] = [
        { eventType: 1, date: "2026-03-12T10:00:00Z" },
        { eventType: 4, date: "2026-03-11T08:30:00Z" },
        { eventType: 7, date: "2026-03-10T14:00:00Z" },
        null,
      ];
      return {
        status: "wanted",
        downloadProgress: null,
        quality: null,
        sourceIndexer: null,
        lastEvent: eventVariants[hash % eventVariants.length],
        lidarrAlbumId: 1000 + (hash % 500),
      };
    }

    case "imported": {
      const indexers = ["Soulseek", "Torznab", null];
      return {
        status: "imported",
        downloadProgress: null,
        quality: null,
        sourceIndexer: indexers[hash % indexers.length],
        lastEvent: null,
        lidarrAlbumId: null,
      };
    }

    default:
      return {
        status: null,
        downloadProgress: null,
        quality: null,
        sourceIndexer: null,
        lastEvent: null,
        lidarrAlbumId: null,
      };
  }
}

async function loadRequestedMbids(albumMbids: string[]): Promise<Set<string>> {
  if (albumMbids.length === 0) return new Set();

  try {
    const rows = await getDataSource()
      .getRepository(Request)
      .find({
        where: { album_mbid: In(albumMbids) },
        select: { album_mbid: true },
      });
    return new Set(rows.map((row) => row.album_mbid));
  } catch (err) {
    log.warn(`Failed to load requested album mbids: ${err}`);
    return new Set();
  }
}

/**
 * Fabricates lifecycle states for albums that actually have a request row, so
 * mock mode exercises the request lifecycle without inventing statuses for
 * albums nobody asked for (the discover feed asks about arbitrary MBIDs).
 */
export async function mockEnrichRequestsWithLidarr(
  albumMbids: string[]
): Promise<(LidarrLifecycleDetails | null)[]> {
  const requested = await loadRequestedMbids(albumMbids);

  return albumMbids.map((mbid) =>
    requested.has(mbid) ? mockForMbid(mbid) : null
  );
}
