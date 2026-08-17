import { getConfig, setConfig } from "../../config";
import { isLiveEventsConfigured } from "../../api/jambase/config";
import { searchEvents, MAX_PER_PAGE } from "../../api/jambase/events";
import {
  listFollowedJambaseIds,
  listLiveRegionsUnion,
  upsertSweptEvents,
  applyTombstones,
} from "../../db/liveEvents";
import { createLogger } from "../../logger";

export type RosterSweepResult = {
  ran: boolean;
  isFullPass: boolean;
  batches: number;
  pages: number;
  events: number;
  tombstones: number;
  hitPageCap: boolean;
  completed: boolean;
};

const log = createLogger("live-roster");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The vendor's documented delta pattern: overlap the watermark by five minutes
 * so an event modified during the previous run is not skipped by it.
 */
const WATERMARK_PADDING_MS = 5 * 60 * 1000;

function calendarDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/** RFC3339 with a space, matching the format the API's examples use. */
function toWatermark(at: Date): string {
  return at.toISOString().replace("T", " ").slice(0, 19);
}

function isFullPassDue(
  watermark: string | null,
  fullSweptAt: string | null,
  intervalDays: number,
  now: number
): boolean {
  if (watermark === null || fullSweptAt === null) return true;
  const last = Date.parse(fullSweptAt);
  if (Number.isNaN(last)) return true;
  return now - last >= intervalDays * DAY_MS;
}

function emptyResult(isFullPass = false): RosterSweepResult {
  return {
    ran: false,
    isFullPass,
    batches: 0,
    pages: 0,
    events: 0,
    tombstones: 0,
    hitPageCap: false,
    completed: false,
  };
}

async function sweepBatch(
  artistIds: string[],
  params: {
    countries: string[];
    dateFrom: string;
    dateTo: string;
    dateModifiedFrom?: string;
    sweptAt: string;
    pageBudget: number;
  },
  result: RosterSweepResult
): Promise<number> {
  let page = 1;
  let totalPages = 1;
  let spent = 0;

  while (page <= totalPages) {
    if (spent >= params.pageBudget) {
      result.hitPageCap = true;
      break;
    }

    const response = await searchEvents({
      artistIds,
      countries: params.countries,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      dateModifiedFrom: params.dateModifiedFrom,
      page,
      perPage: MAX_PER_PAGE,
    });
    spent += 1;
    result.pages += 1;

    await upsertSweptEvents(response.events, params.sweptAt);
    await applyTombstones(response.tombstones);
    result.events += response.events.length;
    result.tombstones += response.tombstones.length;

    totalPages = response.totalPages;
    page += 1;
  }

  return spent;
}

/**
 * Fetch every followed artist's in-scope dates, batching up to
 * `rosterBatchSize` artist ids per call.
 *
 * A delta sweep only advances the watermark on a clean, uncapped run: a partial
 * pass that moved it would silently lose every event it did not reach.
 */
export async function runRosterSweep(): Promise<RosterSweepResult> {
  if (!isLiveEventsConfigured()) return emptyResult();

  const { liveEvents } = getConfig();
  const artistIds = await listFollowedJambaseIds();
  if (artistIds.length === 0) {
    log.info("No resolved followed artists yet, nothing to sweep");
    return emptyResult();
  }

  const now = new Date();
  const isFullPass = isFullPassDue(
    liveEvents.rosterWatermark,
    liveEvents.rosterFullSweptAt,
    liveEvents.fullSweepIntervalDays,
    now.getTime()
  );

  const union = await listLiveRegionsUnion();
  const countries = union.length > 0 ? union : liveEvents.regions;

  const result: RosterSweepResult = { ...emptyResult(isFullPass), ran: true };
  const sweptAt = now.toISOString();
  const batches = chunk(artistIds, liveEvents.rosterBatchSize);
  let budget = liveEvents.maxPagesPerRun;

  log.info(
    `${isFullPass ? "Full" : "Delta"} roster sweep: ${artistIds.length} artist(s) in ${batches.length} batch(es), countries=${countries.join("|") || "any"}`
  );

  for (const batch of batches) {
    if (budget <= 0) {
      result.hitPageCap = true;
      break;
    }
    result.batches += 1;
    const spent = await sweepBatch(
      batch,
      {
        countries,
        dateFrom: calendarDay(now),
        dateTo: calendarDay(
          new Date(now.getTime() + liveEvents.bannerHorizonDays * DAY_MS)
        ),
        dateModifiedFrom: isFullPass
          ? undefined
          : (liveEvents.rosterWatermark ?? undefined),
        sweptAt,
        pageBudget: budget,
      },
      result
    );
    budget -= spent;
  }

  result.completed = !result.hitPageCap && result.batches === batches.length;

  if (result.completed) {
    setConfig({
      liveEvents: {
        rosterWatermark: toWatermark(
          new Date(now.getTime() - WATERMARK_PADDING_MS)
        ),
        ...(isFullPass ? { rosterFullSweptAt: sweptAt } : {}),
      },
    });
  } else {
    log.warn(
      `Sweep incomplete (pages=${result.pages}, cap hit=${result.hitPageCap}); watermark left where it was`
    );
  }

  log.info(
    `Roster sweep done: ${result.pages} page(s), ${result.events} event(s), ${result.tombstones} tombstone(s)`
  );
  return result;
}
