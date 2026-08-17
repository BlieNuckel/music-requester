import { getConfig } from "../../config";
import { isLiveEventsConfigured } from "../../api/jambase/config";
import { searchEvents, MAX_PER_PAGE } from "../../api/jambase/events";
import {
  upsertSweptEvents,
  applyTombstones,
  findEventKeysInWindow,
  markDisappeared,
} from "../../db/liveEvents";
import { createLogger } from "../../logger";

export type GeoSweepResult = {
  ran: boolean;
  pages: number;
  events: number;
  tombstones: number;
  disappeared: number;
  hitPageCap: boolean;
  completed: boolean;
};

export type BoundingBox = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

const log = createLogger("live-geo-sweep");

const DAY_MS = 24 * 60 * 60 * 1000;
const KM_PER_DEGREE_LAT = 111;

function calendarDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * A box that contains the circle, deliberately generous: it is used to decide
 * which stored rows this sweep was entitled to see, so erring wide means we
 * merely re-check a row rather than wrongly leaving one unreconciled.
 */
export function boundingBox(
  lat: number,
  lon: number,
  radiusKm: number
): BoundingBox {
  const latDelta = radiusKm / KM_PER_DEGREE_LAT;
  const lonDelta =
    radiusKm /
    (KM_PER_DEGREE_LAT * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));

  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta,
  };
}

function emptyResult(): GeoSweepResult {
  return {
    ran: false,
    pages: 0,
    events: 0,
    tombstones: 0,
    disappeared: 0,
    hitPageCap: false,
    completed: false,
  };
}

/**
 * Everything playing near the instance's origin in the next few weeks,
 * including artists nobody follows. This is the shelf's only feeder.
 *
 * Unlike the roster sweep this does a **full refresh** rather than a
 * `dateModifiedFrom` delta. At a 150 km radius over 28 days the whole result
 * set is one page, so a delta would cost the same single call while giving up
 * the self-healing property a complete result set provides.
 */
export async function runGeoSweep(): Promise<GeoSweepResult> {
  if (!isLiveEventsConfigured()) return emptyResult();

  const { liveEvents } = getConfig();
  const { originLat, originLon } = liveEvents;

  if (originLat === null || originLon === null) {
    log.info("No sweep origin configured, skipping the nearby sweep");
    return emptyResult();
  }

  const now = Date.now();
  const sweptAt = new Date(now).toISOString();
  const window = {
    from: calendarDay(now),
    to: calendarDay(now + liveEvents.shelfHorizonDays * DAY_MS),
  };

  const result: GeoSweepResult = { ...emptyResult(), ran: true };
  const seen = new Set<string>();

  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    if (result.pages >= liveEvents.maxPagesPerRun) {
      result.hitPageCap = true;
      break;
    }

    const response = await searchEvents({
      latitude: originLat,
      longitude: originLon,
      radiusKm: liveEvents.sweepRadiusKm,
      dateFrom: window.from,
      dateTo: window.to,
      page,
      perPage: MAX_PER_PAGE,
    });
    result.pages += 1;

    await upsertSweptEvents(response.events, sweptAt);
    await applyTombstones(response.tombstones);
    for (const event of response.events) seen.add(event.event_key);

    result.events += response.events.length;
    result.tombstones += response.tombstones.length;
    totalPages = response.totalPages;
    page += 1;
  }

  result.completed = !result.hitPageCap;

  if (result.completed) {
    result.disappeared = await reconcile(
      seen,
      window,
      boundingBox(originLat, originLon, liveEvents.sweepRadiusKm),
      sweptAt
    );
  } else {
    log.warn(
      `Nearby sweep hit the page cap after ${result.pages} page(s); skipping reconciliation`
    );
  }

  log.info(
    `Nearby sweep: ${result.pages} page(s), ${result.events} event(s), ${result.disappeared} gone`
  );
  return result;
}

/**
 * Absence is only meaningful for rows this sweep could actually have returned,
 * so reconciliation is scoped to the box and date range that were enumerated.
 * A Berlin date for a followed artist is invisible to a Malmö sweep and must
 * survive it untouched.
 */
async function reconcile(
  seen: Set<string>,
  window: { from: string; to: string },
  bounds: BoundingBox,
  sweptAt: string
): Promise<number> {
  const stored = await findEventKeysInWindow(window, bounds);
  const missing = stored.filter((key) => !seen.has(key));
  if (missing.length === 0) return 0;

  return markDisappeared(missing, sweptAt);
}
