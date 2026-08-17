import { In } from "typeorm";
import {
  getDataSource,
  FollowedArtist,
  LiveEvent,
  LiveEventPerformer,
  UserLiveEventState,
  User,
} from "./index";
import type {
  LiveEventStatus,
  LiveEventDeletionStatus,
  LiveEventResponse,
} from "./index";

export type SweptPerformer = {
  artist_jambase_id: string;
  artist_name: string;
  is_headliner: boolean;
  performance_rank: number | null;
  genres: string[] | null;
};

export type SweptEvent = {
  event_key: string;
  name: string;
  event_date: string;
  previous_start_date: string | null;
  event_status: LiveEventStatus;
  venue_name: string | null;
  venue_city: string | null;
  venue_country: string | null;
  venue_lat: number | null;
  venue_lon: number | null;
  ticket_url: string | null;
  image_url: string | null;
  performers: SweptPerformer[];
};

export type Tombstone = {
  event_key: string;
  deletion_status: LiveEventDeletionStatus;
  deleted_at: string | null;
  merged_into: string | null;
};

export type UpsertOutcome = {
  inserted: string[];
  updated: string[];
  statusChanged: string[];
};

export type EventWindow = {
  from: string;
  to: string;
};

export type NearbyQuery = EventWindow & {
  lat: number;
  lon: number;
  radiusKm: number;
};

export type FollowedEventsQuery = EventWindow & {
  countries?: readonly string[] | null;
};

export type UserLivePreferences = {
  live_radius_km: number | null;
  live_lat: number | null;
  live_lon: number | null;
  live_regions: string[] | null;
  live_announce_days: number | null;
  live_imminent_days_local: number | null;
  live_imminent_days_regional: number | null;
  live_banner_enabled: boolean | null;
};

export type HydratedLiveEvent = LiveEvent & {
  performers: LiveEventPerformer[];
  state: UserLiveEventState | null;
  distanceKm: number | null;
};

const EARTH_RADIUS_KM = 6371;

function eventRepo() {
  return getDataSource().getRepository(LiveEvent);
}

function performerRepo() {
  return getDataSource().getRepository(LiveEventPerformer);
}

function stateRepo() {
  return getDataSource().getRepository(UserLiveEventState);
}

function artistRepo() {
  return getDataSource().getRepository(FollowedArtist);
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in km. Exported so read-time distance tiers agree. */
export function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export function parseLiveRegions(json: string | null): string[] | null {
  if (json === null) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((code): code is string => typeof code === "string")
      : null;
  } catch {
    return null;
  }
}

export function serializeLiveRegions(codes: string[] | null): string | null {
  return codes === null ? null : JSON.stringify(codes);
}

export function serializeGenres(genres: string[] | null): string | null {
  return genres === null || genres.length === 0 ? null : JSON.stringify(genres);
}

export function parseGenres(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((genre): genre is string => typeof genre === "string")
      : [];
  } catch {
    return [];
  }
}

function assignEventFields(row: LiveEvent, event: SweptEvent): void {
  row.name = event.name;
  row.event_date = event.event_date;
  row.previous_start_date = event.previous_start_date;
  row.event_status = event.event_status;
  row.venue_name = event.venue_name;
  row.venue_city = event.venue_city;
  row.venue_country = event.venue_country;
  row.venue_lat = event.venue_lat;
  row.venue_lon = event.venue_lon;
  row.ticket_url = event.ticket_url;
  row.image_url = event.image_url;
}

/**
 * Upsert a sweep's results. Idempotent on `event_key`, and safe to run against a
 * partial result set: it only ever writes what it was given, so a sweep that
 * died mid-pagination degrades to "some rows are stale" rather than to data loss.
 *
 * Re-seeing an event clears `disappeared_at`, since the sweep just proved
 * otherwise.
 */
export async function upsertSweptEvents(
  events: readonly SweptEvent[],
  sweptAt: string
): Promise<UpsertOutcome> {
  const outcome: UpsertOutcome = {
    inserted: [],
    updated: [],
    statusChanged: [],
  };
  if (events.length === 0) return outcome;

  await getDataSource().transaction(async (manager) => {
    const eventManager = manager.getRepository(LiveEvent);
    const performerManager = manager.getRepository(LiveEventPerformer);

    for (const event of events) {
      const existing = await eventManager.findOne({
        where: { event_key: event.event_key },
      });

      const row =
        existing ??
        eventManager.create({
          event_key: event.event_key,
          first_seen_at: sweptAt,
        });
      const statusChanged =
        existing !== null && existing.event_status !== event.event_status;

      assignEventFields(row, event);
      row.last_seen_at = sweptAt;
      row.disappeared_at = null;
      if (statusChanged) row.status_changed_at = sweptAt;

      const saved = await eventManager.save(row);

      await performerManager.delete({ event_id: saved.id });
      if (event.performers.length > 0) {
        await performerManager.insert(
          event.performers.map((performer) => ({
            event_id: saved.id,
            artist_jambase_id: performer.artist_jambase_id,
            artist_name: performer.artist_name,
            is_headliner: performer.is_headliner,
            performance_rank: performer.performance_rank,
            genres: serializeGenres(performer.genres),
          }))
        );
      }

      if (existing) outcome.updated.push(event.event_key);
      else outcome.inserted.push(event.event_key);
      if (statusChanged) outcome.statusChanged.push(event.event_key);
    }
  });

  return outcome;
}

/**
 * Event keys we already hold inside a window, so a caller that fully enumerated
 * that same window can diff and reconcile. Scoping lives with the caller because
 * only it knows what its sweep actually covered.
 */
export async function findEventKeysInWindow(
  window: EventWindow,
  bounds?: { minLat: number; maxLat: number; minLon: number; maxLon: number }
): Promise<string[]> {
  const query = eventRepo()
    .createQueryBuilder("e")
    .select("e.event_key", "event_key")
    .where("e.event_date >= :from AND e.event_date <= :to", window)
    .andWhere("e.deletion_status IS NULL");

  if (bounds) {
    query
      .andWhere("e.venue_lat BETWEEN :minLat AND :maxLat", bounds)
      .andWhere("e.venue_lon BETWEEN :minLon AND :maxLon", bounds);
  }

  const rows = await query.getRawMany<{ event_key: string }>();
  return rows.map((row) => row.event_key);
}

export async function markDisappeared(
  eventKeys: readonly string[],
  at: string
): Promise<number> {
  if (eventKeys.length === 0) return 0;
  const result = await eventRepo().update(
    { event_key: In([...eventKeys]) },
    { disappeared_at: at }
  );
  return result.affected ?? 0;
}

/**
 * Tombstones are the authoritative removal signal on delta pages. `merged` is
 * not a deletion: the row is repointed at its survivor so anything holding the
 * old key can follow it.
 */
export async function applyTombstones(
  tombstones: readonly Tombstone[]
): Promise<number> {
  if (tombstones.length === 0) return 0;
  let applied = 0;

  await getDataSource().transaction(async (manager) => {
    const events = manager.getRepository(LiveEvent);
    for (const tombstone of tombstones) {
      const result = await events.update(
        { event_key: tombstone.event_key },
        {
          deletion_status: tombstone.deletion_status,
          merged_into: tombstone.merged_into,
          disappeared_at: tombstone.deleted_at,
        }
      );
      applied += result.affected ?? 0;
    }
  });

  return applied;
}

async function hydrate(
  events: LiveEvent[],
  userId: number,
  origin?: { lat: number | null; lon: number | null }
): Promise<HydratedLiveEvent[]> {
  if (events.length === 0) return [];
  const ids = events.map((event) => event.id);

  const [performers, states] = await Promise.all([
    performerRepo().find({ where: { event_id: In(ids) } }),
    stateRepo().find({ where: { user_id: userId, event_id: In(ids) } }),
  ]);

  const performersByEvent = new Map<number, LiveEventPerformer[]>();
  for (const performer of performers) {
    const list = performersByEvent.get(performer.event_id) ?? [];
    list.push(performer);
    performersByEvent.set(performer.event_id, list);
  }
  const stateByEvent = new Map(states.map((state) => [state.event_id, state]));

  return events.map((event) => ({
    ...event,
    performers: performersByEvent.get(event.id) ?? [],
    state: stateByEvent.get(event.id) ?? null,
    distanceKm:
      origin?.lat != null &&
      origin.lon != null &&
      event.venue_lat != null &&
      event.venue_lon != null
        ? distanceKm(origin.lat, origin.lon, event.venue_lat, event.venue_lon)
        : null,
  }));
}

/** Events in a window whose lineup includes an artist this user follows. */
export async function findFollowedUpcomingEvents(
  userId: number,
  query: FollowedEventsQuery
): Promise<HydratedLiveEvent[]> {
  const builder = eventRepo()
    .createQueryBuilder("e")
    .innerJoin(LiveEventPerformer, "p", "p.event_id = e.id")
    .innerJoin(
      FollowedArtist,
      "fa",
      "fa.jambase_artist_id = p.artist_jambase_id AND fa.user_id = :userId",
      { userId }
    )
    .where("e.event_date >= :from AND e.event_date <= :to", {
      from: query.from,
      to: query.to,
    })
    .andWhere("e.deletion_status IS NULL")
    .andWhere("e.disappeared_at IS NULL");

  if (query.countries && query.countries.length > 0) {
    builder.andWhere("e.venue_country IN (:...countries)", {
      countries: [...query.countries],
    });
  }

  const events = await builder
    .distinct(true)
    .orderBy("e.event_date", "ASC")
    .getMany();

  return hydrate(events, userId);
}

/**
 * Events near a point. SQLite has no trig, so a bounding box narrows in SQL and
 * the great-circle refine happens here; the box is a superset, never a filter.
 */
export async function findNearbyEvents(
  userId: number,
  query: NearbyQuery
): Promise<HydratedLiveEvent[]> {
  const latDelta = query.radiusKm / 111;
  const lonDelta =
    query.radiusKm / (111 * Math.max(Math.cos(toRadians(query.lat)), 0.01));

  const events = await eventRepo()
    .createQueryBuilder("e")
    .where("e.event_date >= :from AND e.event_date <= :to", {
      from: query.from,
      to: query.to,
    })
    .andWhere("e.deletion_status IS NULL")
    .andWhere("e.disappeared_at IS NULL")
    .andWhere("e.venue_lat BETWEEN :minLat AND :maxLat", {
      minLat: query.lat - latDelta,
      maxLat: query.lat + latDelta,
    })
    .andWhere("e.venue_lon BETWEEN :minLon AND :maxLon", {
      minLon: query.lon - lonDelta,
      maxLon: query.lon + lonDelta,
    })
    .orderBy("e.event_date", "ASC")
    .getMany();

  const hydrated = await hydrate(events, userId, {
    lat: query.lat,
    lon: query.lon,
  });
  return hydrated.filter(
    (event) => event.distanceKm !== null && event.distanceKm <= query.radiusKm
  );
}

export async function findEventsForArtist(
  userId: number,
  jambaseArtistId: string,
  options: { includePast?: boolean; now: string }
): Promise<HydratedLiveEvent[]> {
  const builder = eventRepo()
    .createQueryBuilder("e")
    .innerJoin(
      LiveEventPerformer,
      "p",
      "p.event_id = e.id AND p.artist_jambase_id = :jambaseArtistId",
      { jambaseArtistId }
    )
    .where("e.deletion_status IS NULL");

  if (!options.includePast) {
    builder.andWhere("e.event_date >= :now", { now: options.now });
  }

  const events = await builder.orderBy("e.event_date", "ASC").getMany();
  return hydrate(events, userId);
}

export async function findAllForUser(
  userId: number,
  filters: { response?: LiveEventResponse | null; past?: boolean; now: string }
): Promise<HydratedLiveEvent[]> {
  const builder = eventRepo()
    .createQueryBuilder("e")
    .innerJoin(LiveEventPerformer, "p", "p.event_id = e.id")
    .innerJoin(
      FollowedArtist,
      "fa",
      "fa.jambase_artist_id = p.artist_jambase_id AND fa.user_id = :userId",
      { userId }
    )
    .where("e.deletion_status IS NULL");

  builder.andWhere(
    filters.past ? "e.event_date < :now" : "e.event_date >= :now",
    { now: filters.now }
  );

  const events = await builder
    .distinct(true)
    .orderBy("e.event_date", filters.past ? "DESC" : "ASC")
    .getMany();

  const hydrated = await hydrate(events, userId);
  if (filters.response === undefined) return hydrated;
  return hydrated.filter(
    (event) => (event.state?.response ?? null) === filters.response
  );
}

async function upsertState(
  userId: number,
  eventId: number,
  patch: Partial<UserLiveEventState>
): Promise<UserLiveEventState> {
  const repo = stateRepo();
  const existing = await repo.findOne({
    where: { user_id: userId, event_id: eventId },
  });
  const row = existing ?? repo.create({ user_id: userId, event_id: eventId });
  return repo.save(Object.assign(row, patch));
}

export async function setUserResponse(
  userId: number,
  eventId: number,
  response: LiveEventResponse | null,
  at: string
): Promise<UserLiveEventState> {
  return upsertState(userId, eventId, {
    response,
    responded_at: response === null ? null : at,
  });
}

export async function markViewed(
  userId: number,
  eventId: number,
  at: string
): Promise<UserLiveEventState> {
  return upsertState(userId, eventId, { viewed_at: at });
}

export async function markNotified(
  userId: number,
  eventId: number,
  at: string
): Promise<UserLiveEventState> {
  return upsertState(userId, eventId, { notified_at: at });
}

export async function setJambaseArtistId(
  followedArtistId: number,
  jambaseArtistId: string | null,
  resolvedAt: string
): Promise<void> {
  await artistRepo().update(
    { id: followedArtistId },
    { jambase_artist_id: jambaseArtistId, jambase_resolved_at: resolvedAt }
  );
}

/**
 * Followed artists never resolved against JamBase. A row with
 * `jambase_resolved_at` set and a null id is a confirmed miss and is excluded,
 * so an artist JamBase has never heard of is not re-resolved every sweep.
 */
export async function findUnresolvedFollowedArtists(
  limit: number
): Promise<FollowedArtist[]> {
  return artistRepo()
    .createQueryBuilder("fa")
    .where("fa.jambase_resolved_at IS NULL")
    .orderBy("fa.created_at", "ASC")
    .limit(limit)
    .getMany();
}

/**
 * The JamBase id any user has already resolved for this MBID. Artist pages key
 * off MBIDs, but events key off JamBase ids, and this is the only bridge that
 * does not involve matching names.
 */
export async function findJambaseIdForArtistMbid(
  artistMbid: string
): Promise<string | null> {
  const row = await artistRepo()
    .createQueryBuilder("fa")
    .select("fa.jambase_artist_id", "jambase_artist_id")
    .where("fa.artist_mbid = :artistMbid", { artistMbid })
    .andWhere("fa.jambase_artist_id IS NOT NULL")
    .limit(1)
    .getRawOne<{ jambase_artist_id: string }>();
  return row?.jambase_artist_id ?? null;
}

/** Distinct JamBase artist ids across all users, for batched sweeps. */
export async function listFollowedJambaseIds(): Promise<string[]> {
  const rows = await artistRepo()
    .createQueryBuilder("fa")
    .select("DISTINCT fa.jambase_artist_id", "jambase_artist_id")
    .where("fa.jambase_artist_id IS NOT NULL")
    .getRawMany<{ jambase_artist_id: string }>();
  return rows.map((row) => row.jambase_artist_id);
}

/**
 * Union of every user's configured regions. The sweep is shared, so it has to
 * cover the union; per-user narrowing happens at read time.
 */
export async function listLiveRegionsUnion(): Promise<string[]> {
  const rows = await getDataSource()
    .getRepository(User)
    .createQueryBuilder("u")
    .select("u.live_regions", "live_regions")
    .where("u.live_regions IS NOT NULL")
    .getRawMany<{ live_regions: string }>();

  const union = new Set<string>();
  for (const row of rows) {
    for (const code of parseLiveRegions(row.live_regions) ?? []) {
      union.add(code);
    }
  }
  return [...union];
}

export async function getUserLivePreferences(
  userId: number
): Promise<UserLivePreferences | null> {
  const row = await getDataSource()
    .getRepository(User)
    .findOne({ where: { id: userId } });
  if (!row) return null;

  return {
    live_radius_km: row.live_radius_km,
    live_lat: row.live_lat,
    live_lon: row.live_lon,
    live_regions: parseLiveRegions(row.live_regions),
    live_announce_days: row.live_announce_days,
    live_imminent_days_local: row.live_imminent_days_local,
    live_imminent_days_regional: row.live_imminent_days_regional,
    live_banner_enabled: row.live_banner_enabled,
  };
}

export async function setUserLivePreferences(
  userId: number,
  patch: Partial<Omit<UserLivePreferences, "live_regions">> & {
    live_regions?: string[] | null;
  }
): Promise<void> {
  const { live_regions, ...rest } = patch;
  await getDataSource()
    .getRepository(User)
    .update(
      { id: userId },
      live_regions === undefined
        ? rest
        : { ...rest, live_regions: serializeLiveRegions(live_regions) }
    );
}
