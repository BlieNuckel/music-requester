import { resilientFetch } from "../resilientFetch";
import { getPlexConfig } from "./config";
import { getMusicSectionKeys } from "./sections";
import type { PlexHistoryMetadata, PlexHistoryResponse } from "./types";

/** One committed play, as Plex's own event log records it. */
export type PlexHistoryEntry = {
  ratingKey: string;
  title: string;
  artistKey: string;
  artistName: string;
  albumKey: string;
  albumTitle: string;
  /** Unix **seconds**, as Plex reports it. */
  viewedAt: number;
  deviceID?: number;
  accountID?: number;
};

const PAGE_SIZE = 1000;

const buildPageUrl = (
  baseUrl: string,
  sectionKey: string,
  sinceSeconds: number,
  start: number
): string =>
  `${baseUrl}/status/sessions/history/all?librarySectionID=${sectionKey}` +
  `&viewedAt%3E=${sinceSeconds}&sort=viewedAt:asc` +
  `&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${PAGE_SIZE}`;

/**
 * The numeric id at the end of a `/library/metadata/1234` path. History rows carry the
 * parent and grandparent as paths; some PMS versions also send the plain rating keys, so
 * this is only the fallback.
 */
const keyFromPath = (path?: string): string =>
  path ? (path.split("/").pop() ?? "") : "";

const mapEntry = (raw: PlexHistoryMetadata): PlexHistoryEntry => ({
  ratingKey: raw.ratingKey ?? "",
  title: raw.title ?? "",
  artistKey: raw.grandparentRatingKey ?? keyFromPath(raw.grandparentKey),
  artistName: raw.grandparentTitle ?? "",
  albumKey: raw.parentRatingKey ?? keyFromPath(raw.parentKey),
  albumTitle: raw.parentTitle ?? "",
  viewedAt: raw.viewedAt,
  deviceID: raw.deviceID,
  accountID: raw.accountID,
});

const isUsable = (raw: PlexHistoryMetadata): boolean =>
  Boolean(raw.ratingKey) &&
  typeof raw.viewedAt === "number" &&
  Boolean(raw.grandparentTitle || raw.grandparentRatingKey);

async function fetchPage(
  baseUrl: string,
  headers: Record<string, string>,
  sectionKey: string,
  sinceSeconds: number,
  start: number
): Promise<{ items: PlexHistoryEntry[]; rowCount: number; totalSize: number }> {
  const res = await resilientFetch(
    buildPageUrl(baseUrl, sectionKey, sinceSeconds, start),
    { headers }
  );
  if (!res.ok) throw new Error(`Plex returned ${res.status}`);

  const data: PlexHistoryResponse = await res.json();
  const container = data.MediaContainer;
  const metadata = container?.Metadata ?? [];

  return {
    items: metadata.filter(isUsable).map(mapEntry),
    rowCount: metadata.length,
    totalSize: container?.totalSize ?? metadata.length,
  };
}

/**
 * One music section's play history from `sinceSeconds` onwards, paged to completion.
 * Sorted ascending so paging stays stable while the log grows underneath us — a new play
 * lands at the end rather than shifting every row we have not read yet.
 */
async function walkSection(
  baseUrl: string,
  headers: Record<string, string>,
  sectionKey: string,
  sinceSeconds: number
): Promise<PlexHistoryEntry[]> {
  const all: PlexHistoryEntry[] = [];
  let start = 0;
  for (;;) {
    const page = await fetchPage(
      baseUrl,
      headers,
      sectionKey,
      sinceSeconds,
      start
    );
    all.push(...page.items);
    start += PAGE_SIZE;
    if (page.rowCount < PAGE_SIZE || start >= page.totalSize) break;
  }
  return all;
}

/**
 * Every committed play across every music section since `sinceSeconds` (Unix seconds; `0`
 * reads the whole log). Plex's event log is the only source with a real timestamp per play
 * and it survives Plexamp replaying plays it cached while offline, which is why it is the
 * spine the other listening sources join onto.
 *
 * Rows are scoped to the token's own account by Plex. Sections are walked sequentially so a
 * server with several music libraries doesn't get several concurrent full sweeps.
 */
export async function getPlayHistory(
  plexToken: string,
  sinceSeconds = 0
): Promise<PlexHistoryEntry[]> {
  const { baseUrl, headers } = getPlexConfig(plexToken);
  const sectionKeys = await getMusicSectionKeys(baseUrl, headers);

  const all: PlexHistoryEntry[] = [];
  for (const sectionKey of sectionKeys) {
    all.push(
      ...(await walkSection(baseUrl, headers, sectionKey, sinceSeconds))
    );
  }
  return all.sort((a, b) => a.viewedAt - b.viewedAt);
}
