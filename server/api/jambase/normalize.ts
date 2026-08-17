import type {
  SweptEvent,
  SweptPerformer,
  Tombstone,
} from "../../db/liveEvents";
import type { LiveEventStatus } from "../../db/index";
import type {
  JambaseEvent,
  JambasePerformer,
  JambaseVenue,
  JambaseOffer,
} from "./types";

export type NormalizedPage = {
  events: SweptEvent[];
  tombstones: Tombstone[];
  /** Rows that were neither: no usable identifier or no date. */
  skipped: number;
};

const STATUSES: Record<string, LiveEventStatus> = {
  eventscheduled: "scheduled",
  eventrescheduled: "rescheduled",
  eventpostponed: "postponed",
  eventcancelled: "cancelled",
  eventcanceled: "cancelled",
  scheduled: "scheduled",
  rescheduled: "rescheduled",
  postponed: "postponed",
  cancelled: "cancelled",
  canceled: "cancelled",
};

const DELETION_STATUSES = new Set(["deleted", "trashed", "merged"]);

function asArray<T>(value: T[] | T | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Schema.org spells these `https://schema.org/EventCancelled`; we want the leaf. */
export function normalizeStatus(
  raw: string | null | undefined
): LiveEventStatus {
  if (!raw) return "scheduled";
  const leaf = raw.split("/").pop() ?? raw;
  return STATUSES[leaf.toLowerCase()] ?? "scheduled";
}

/** Dates arrive as RFC3339; the store keeps calendar days for range queries. */
export function toCalendarDay(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const day = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function countryOf(venue: JambaseVenue | null | undefined): string | null {
  const country = venue?.address?.addressCountry;
  if (!country) return null;
  const code =
    typeof country === "string"
      ? country
      : (country.identifier ?? country.name);
  if (!code) return null;
  // JamBase source data sometimes says UK where the API expects GB.
  const upper = code.toUpperCase();
  return upper === "UK" ? "GB" : upper;
}

function ticketUrlOf(
  offers: JambaseOffer[] | JambaseOffer | null | undefined
): string | null {
  for (const offer of asArray(offers)) {
    if (offer.url) return offer.url;
  }
  return null;
}

function normalizePerformers(
  raw: JambasePerformer[] | JambasePerformer | null | undefined
): SweptPerformer[] {
  const seen = new Set<string>();
  const performers: SweptPerformer[] = [];

  for (const performer of asArray(raw)) {
    const id = performer.identifier;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    performers.push({
      artist_jambase_id: id,
      artist_name: performer.name ?? "Unknown artist",
      is_headliner: performer["x-isHeadliner"] === true,
      performance_rank: performer["x-performanceRank"] ?? null,
    });
  }

  return performers;
}

function toTombstone(raw: JambaseEvent): Tombstone | null {
  const status = raw.deletionStatus?.toLowerCase();
  if (!raw.identifier || !status || !DELETION_STATUSES.has(status)) return null;
  return {
    event_key: raw.identifier,
    deletion_status: status as Tombstone["deletion_status"],
    deleted_at: raw.deletedAt ?? null,
    merged_into: raw.mergedInto ?? null,
  };
}

function toSweptEvent(raw: JambaseEvent): SweptEvent | null {
  const eventDate = toCalendarDay(raw.startDate);
  if (!raw.identifier || !eventDate) return null;

  const venue = raw.location ?? null;

  return {
    event_key: raw.identifier,
    name: raw.name ?? "Untitled event",
    event_date: eventDate,
    previous_start_date: toCalendarDay(raw.previousStartDate),
    event_status: normalizeStatus(raw.eventStatus),
    venue_name: venue?.name ?? null,
    venue_city: venue?.address?.addressLocality ?? null,
    venue_country: countryOf(venue),
    venue_lat: toNumber(venue?.geo?.latitude),
    venue_lon: toNumber(venue?.geo?.longitude),
    ticket_url: ticketUrlOf(raw.offers) ?? raw.url ?? null,
    image_url: raw.image ?? null,
    performers: normalizePerformers(raw.performer),
  };
}

/**
 * Split a page into events and tombstones. Tombstones share the array with real
 * events on delta responses and count toward `perPage`, so they have to be
 * separated rather than filtered away.
 */
export function normalizeEvents(
  raw: readonly JambaseEvent[] | null | undefined
): NormalizedPage {
  const page: NormalizedPage = { events: [], tombstones: [], skipped: 0 };

  for (const item of raw ?? []) {
    const tombstone = toTombstone(item);
    if (tombstone) {
      page.tombstones.push(tombstone);
      continue;
    }
    const event = toSweptEvent(item);
    if (event) page.events.push(event);
    else page.skipped += 1;
  }

  return page;
}
