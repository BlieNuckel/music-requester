import type { Repository } from "typeorm";
import {
  getDataSource,
  FollowedArtist,
  LiveEvent,
  LiveEventPerformer,
  UserLiveEventState,
} from "../db/index";
import type { LiveEventStatus, LiveEventResponse } from "../db/index";
import { getConfig, setConfig } from "../config";

export type SeedFollowedArtist = {
  mbid: string;
  name: string;
  jambaseId: string;
  genres: string[];
};

export type SeedLivePerformer = {
  jambaseId: string;
  name: string;
  isHeadliner: boolean;
  genres: string[];
};

export type SeedLiveEvent = {
  key: string;
  name: string;
  /** Days from today. Negative is in the past. */
  dayOffset: number;
  /** How long ago we first saw it, which drives the announce window. */
  seenDaysAgo: number;
  status: LiveEventStatus;
  /** Only set for a non-scheduled status; controls the override window. */
  statusChangedDaysAgo?: number;
  previousStartDayOffset?: number;
  venueName: string;
  venueCity: string;
  venueCountry: string;
  lat: number;
  lon: number;
  ticketUrl: string | null;
  performers: SeedLivePerformer[];
  /** Per-user state for the admin account, so every tab has something in it. */
  adminResponse?: LiveEventResponse;
  adminNotified?: boolean;
  note: string;
};

/** Malmö, so the seeded local shows land inside a default sweep radius. */
const ORIGIN = { lat: 55.605, lon: 13.0038 };

const AMIRALEN = {
  venueName: "Amiralen",
  venueCity: "Malmö",
  venueCountry: "SE",
  lat: 55.5975,
  lon: 13.0072,
};
const PLAN_B = {
  venueName: "Plan B",
  venueCity: "Malmö",
  venueCountry: "SE",
  lat: 55.6031,
  lon: 12.9985,
};
const VEGA = {
  venueName: "VEGA",
  venueCity: "København",
  venueCountry: "DK",
  lat: 55.6605,
  lon: 12.5563,
};
const BERGHAIN = {
  venueName: "Berghain",
  venueCity: "Berlin",
  venueCountry: "DE",
  lat: 52.5111,
  lon: 13.4425,
};

export const SEED_FOLLOWED_ARTISTS: SeedFollowedArtist[] = [
  {
    mbid: "b675f327-4738-4af4-bb83-1adb0003f2d3",
    name: "Yves Tumor",
    jambaseId: "jambase:seed-yves",
    genres: ["art-pop", "experimental"],
  },
  {
    mbid: "7230b2f8-96da-4242-8d57-2a8c1c3d71e4",
    name: "Jockstrap",
    jambaseId: "jambase:seed-jockstrap",
    genres: ["art-pop", "electronic"],
  },
  {
    mbid: "fc6fe95d-ab24-44fd-a086-f33a505ad518",
    name: "bar italia",
    jambaseId: "jambase:seed-bar-italia",
    genres: ["indie-rock", "shoegaze"],
  },
  {
    mbid: "6420dd6b-8232-42db-9cb9-90bec8f40e91",
    name: "Nourished by Time",
    jambaseId: "jambase:seed-nourished",
    genres: ["indie-pop", "r-and-b"],
  },
  {
    mbid: "a74b1b7f-71a5-4011-9441-d0b5e4122711",
    name: "Radiohead",
    jambaseId: "jambase:seed-radiohead",
    genres: ["indie-rock", "alternative"],
  },
];

function performer(
  artist: SeedFollowedArtist,
  isHeadliner = true
): SeedLivePerformer {
  return {
    jambaseId: artist.jambaseId,
    name: artist.name,
    isHeadliner,
    genres: artist.genres,
  };
}

const [YVES, JOCKSTRAP, BAR_ITALIA, NOURISHED, RADIOHEAD] =
  SEED_FOLLOWED_ARTISTS;

/**
 * One row per state the UI can be in, so every surface has something to render
 * without anyone having to reason about the window arithmetic first.
 */
export const SEED_LIVE_EVENTS: SeedLiveEvent[] = [
  {
    key: "jambase:seed-1",
    name: "Yves Tumor at Amiralen",
    dayOffset: 12,
    seenDaysAgo: 2,
    status: "scheduled",
    ...AMIRALEN,
    ticketUrl: "https://example.test/tickets/yves",
    performers: [performer(YVES), performer(JOCKSTRAP, false)],
    note: "banner: just announced, local",
  },
  {
    key: "jambase:seed-2",
    name: "bar italia at Plan B",
    dayOffset: 6,
    seenDaysAgo: 40,
    status: "scheduled",
    ...PLAN_B,
    ticketUrl: "https://example.test/tickets/bar-italia",
    performers: [performer(BAR_ITALIA)],
    note: "banner: coming up soon, local (announce window long gone)",
  },
  {
    key: "jambase:seed-3",
    name: "Jockstrap at VEGA",
    dayOffset: 30,
    seenDaysAgo: 30,
    status: "scheduled",
    ...VEGA,
    ticketUrl: "https://example.test/tickets/jockstrap",
    performers: [performer(JOCKSTRAP)],
    note: "banner: regional, inside the longer travel window",
  },
  {
    key: "jambase:seed-4",
    name: "Radiohead at Berghain",
    dayOffset: 150,
    seenDaysAgo: 60,
    status: "scheduled",
    ...BERGHAIN,
    ticketUrl: "https://example.test/tickets/radiohead",
    performers: [performer(RADIOHEAD)],
    note: "quiet: between both windows, /library/live only",
  },
  {
    key: "jambase:seed-5",
    name: "Nourished by Time at Plan B",
    dayOffset: 20,
    seenDaysAgo: 45,
    status: "cancelled",
    // Old enough not to hijack the banner. Drop this to 1 to see that state.
    statusChangedDaysAgo: 40,
    ...PLAN_B,
    ticketUrl: null,
    performers: [performer(NOURISHED)],
    adminNotified: true,
    note: "cancelled pill (raise statusChangedDaysAgo above announceDays to hijack the banner)",
  },
  {
    key: "jambase:seed-6",
    name: "Yves Tumor at VEGA",
    dayOffset: 60,
    seenDaysAgo: 50,
    status: "rescheduled",
    statusChangedDaysAgo: 35,
    previousStartDayOffset: 25,
    ...VEGA,
    ticketUrl: "https://example.test/tickets/yves-vega",
    performers: [performer(YVES)],
    adminNotified: true,
    note: "rescheduled pill with a moved-from date",
  },
  {
    key: "jambase:seed-7",
    name: "Jockstrap at Amiralen",
    dayOffset: 25,
    seenDaysAgo: 20,
    status: "scheduled",
    ...AMIRALEN,
    ticketUrl: "https://example.test/tickets/jockstrap-malmo",
    performers: [performer(JOCKSTRAP)],
    adminResponse: "going",
    adminNotified: true,
    note: "/library/live Going tab",
  },
  {
    key: "jambase:seed-8",
    name: "bar italia at VEGA",
    dayOffset: 18,
    seenDaysAgo: 15,
    status: "scheduled",
    ...VEGA,
    ticketUrl: "https://example.test/tickets/bar-italia-vega",
    performers: [performer(BAR_ITALIA)],
    adminResponse: "dismissed",
    adminNotified: true,
    note: "/library/live Dismissed tab",
  },
  {
    key: "jambase:seed-9",
    name: "Radiohead at Amiralen",
    dayOffset: -45,
    seenDaysAgo: 120,
    status: "scheduled",
    ...AMIRALEN,
    ticketUrl: "https://example.test/tickets/old",
    performers: [performer(RADIOHEAD)],
    adminNotified: true,
    note: "/library/live Past tab",
  },
  {
    key: "jambase:seed-10",
    name: "Skygaze at Plan B",
    dayOffset: 5,
    seenDaysAgo: 3,
    status: "scheduled",
    ...PLAN_B,
    ticketUrl: "https://example.test/tickets/skygaze",
    performers: [
      {
        jambaseId: "jambase:seed-skygaze",
        name: "Skygaze",
        isHeadliner: true,
        genres: ["shoegaze", "dream-pop"],
      },
    ],
    note: "nearby shelf: nobody follows this one",
  },
  {
    key: "jambase:seed-11",
    name: "Kollektiv Nord at Amiralen",
    dayOffset: 9,
    seenDaysAgo: 4,
    status: "scheduled",
    ...AMIRALEN,
    ticketUrl: null,
    performers: [
      {
        jambaseId: "jambase:seed-kollektiv",
        name: "Kollektiv Nord",
        isHeadliner: true,
        genres: ["krautrock", "experimental"],
      },
    ],
    note: "nearby shelf: unfollowed, no ticket link",
  },
  {
    key: "jambase:seed-12",
    name: "bar italia at Plan B (late show)",
    dayOffset: 14,
    seenDaysAgo: 5,
    status: "scheduled",
    ...PLAN_B,
    ticketUrl: "https://example.test/tickets/bar-italia-late",
    performers: [performer(BAR_ITALIA)],
    note: "nearby shelf: followed, so it carries the Following badge",
  },
];

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function calendarDayOffset(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Points the instance at Malmö so the seeded local shows classify as local
 * rather than merely in-country. Leaves the integration disabled and keyless:
 * seeded rows render from SQLite, and nothing should call JamBase in dev.
 */
export function seedLiveEventsConfig(): void {
  const { liveEvents } = getConfig();
  if (liveEvents.originLat !== null && liveEvents.originLon !== null) return;

  setConfig({
    liveEvents: {
      originLat: ORIGIN.lat,
      originLon: ORIGIN.lon,
      regions: ["SE", "DK", "DE"],
    },
  });
}

async function seedFollows(
  repo: Repository<FollowedArtist>,
  userId: number
): Promise<number> {
  let created = 0;

  for (const artist of SEED_FOLLOWED_ARTISTS) {
    const existing = await repo.findOne({
      where: { user_id: userId, artist_mbid: artist.mbid },
    });

    if (existing) {
      // An earlier seed run may predate JamBase resolution.
      if (!existing.jambase_artist_id) {
        await repo.update(
          { id: existing.id },
          {
            jambase_artist_id: artist.jambaseId,
            jambase_resolved_at: isoDaysAgo(1),
          }
        );
      }
      continue;
    }

    await repo.save(
      repo.create({
        user_id: userId,
        artist_mbid: artist.mbid,
        artist_name: artist.name,
        last_checked_at: isoDaysAgo(1),
        jambase_artist_id: artist.jambaseId,
        jambase_resolved_at: isoDaysAgo(1),
      })
    );
    created += 1;
  }

  return created;
}

async function seedOneEvent(
  seed: SeedLiveEvent,
  userId: number
): Promise<boolean> {
  const ds = getDataSource();
  const eventRepo = ds.getRepository(LiveEvent);
  const performerRepo = ds.getRepository(LiveEventPerformer);
  const stateRepo = ds.getRepository(UserLiveEventState);

  if (await eventRepo.findOne({ where: { event_key: seed.key } })) return false;

  const event = await eventRepo.save(
    eventRepo.create({
      event_key: seed.key,
      name: seed.name,
      event_date: calendarDayOffset(seed.dayOffset),
      previous_start_date:
        seed.previousStartDayOffset === undefined
          ? null
          : calendarDayOffset(seed.previousStartDayOffset),
      event_status: seed.status,
      status_changed_at:
        seed.statusChangedDaysAgo === undefined
          ? null
          : isoDaysAgo(seed.statusChangedDaysAgo),
      venue_name: seed.venueName,
      venue_city: seed.venueCity,
      venue_country: seed.venueCountry,
      venue_lat: seed.lat,
      venue_lon: seed.lon,
      ticket_url: seed.ticketUrl,
      image_url: null,
      first_seen_at: isoDaysAgo(seed.seenDaysAgo),
      last_seen_at: isoDaysAgo(0),
      disappeared_at: null,
      deletion_status: null,
      merged_into: null,
    })
  );

  await performerRepo.insert(
    seed.performers.map((p, index) => ({
      event_id: event.id,
      artist_jambase_id: p.jambaseId,
      artist_name: p.name,
      is_headliner: p.isHeadliner,
      performance_rank: index + 1,
      genres: JSON.stringify(p.genres),
    }))
  );

  if (seed.adminResponse || seed.adminNotified) {
    await stateRepo.save(
      stateRepo.create({
        user_id: userId,
        event_id: event.id,
        response: seed.adminResponse ?? null,
        responded_at: seed.adminResponse ? isoDaysAgo(2) : null,
        viewed_at: null,
        notified_at: seed.adminNotified ? isoDaysAgo(2) : null,
      })
    );
  }

  return true;
}

export async function seedLiveEvents(userId: number): Promise<void> {
  seedLiveEventsConfig();

  const follows = await seedFollows(
    getDataSource().getRepository(FollowedArtist),
    userId
  );
  console.log(`  followed ${follows} artist(s) for the live surfaces`);

  let created = 0;
  let skipped = 0;

  for (const seed of SEED_LIVE_EVENTS) {
    if (await seedOneEvent(seed, userId)) {
      console.log(`  ${seed.key.padEnd(18)} ${seed.note}`);
      created += 1;
    } else {
      skipped += 1;
    }
  }

  console.log(`  created ${created} live event(s), skipped ${skipped}`);
}
