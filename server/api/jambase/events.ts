import { jambaseGet } from "./fetch";
import { normalizeEvents } from "./normalize";
import type { NormalizedPage } from "./normalize";
import type { EventSearchParams, JambaseEventsResponse } from "./types";

export type EventPage = NormalizedPage & {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
};

export const MAX_PER_PAGE = 100;

function buildParams(
  params: EventSearchParams
): Record<string, string | number | undefined> {
  const perPage = Math.min(params.perPage ?? MAX_PER_PAGE, MAX_PER_PAGE);

  return {
    page: params.page ?? 1,
    perPage,
    // Pipe-delimited, and artistName is ignored when artistId is present.
    artistId: params.artistIds?.length ? params.artistIds.join("|") : undefined,
    geoCountryIso2: params.countries?.length
      ? params.countries.join("|")
      : undefined,
    geoLatitude: params.latitude,
    geoLongitude: params.longitude,
    geoRadiusAmount: params.radiusKm,
    geoRadiusUnits: params.radiusKm === undefined ? undefined : "km",
    eventDateFrom: params.dateFrom,
    eventDateTo: params.dateTo,
    dateModifiedFrom: params.dateModifiedFrom,
  };
}

function totalPagesOf(totalItems: number, perPage: number): number {
  return perPage > 0 ? Math.ceil(totalItems / perPage) : 0;
}

/** One page of `/events`, normalized and split into events and tombstones. */
export async function searchEvents(
  params: EventSearchParams
): Promise<EventPage> {
  const query = buildParams(params);
  const response = await jambaseGet<JambaseEventsResponse>("/events", query);

  const normalized = normalizeEvents(response.events);
  const perPage = Number(query.perPage) || MAX_PER_PAGE;
  const totalItems =
    response.pagination?.totalItems ?? normalized.events.length;

  return {
    ...normalized,
    page: response.pagination?.page ?? (Number(query.page) || 1),
    perPage,
    totalItems,
    totalPages:
      response.pagination?.totalPages ?? totalPagesOf(totalItems, perPage),
  };
}

/**
 * Total matching events without fetching any of them. Costs one call, which is
 * how a sweep can decide whether a scope is affordable before walking it.
 */
export async function countEvents(
  params: Omit<EventSearchParams, "page" | "perPage">
): Promise<number> {
  const page = await searchEvents({ ...params, page: 1, perPage: 1 });
  return page.totalItems;
}
