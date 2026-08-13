import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initializeDatabase, getDataSource, closeDatabase } from "./index";
import type { DerivedProfile } from "./entity/UserProfile";
import { DERIVED_PROFILE_SCHEMA_VERSION } from "./entity/UserProfile";
import {
  serializeDerivedProfile,
  parseDerivedProfile,
  computeConfigHash,
  getUserProfile,
  upsertUserProfile,
  touchProfileUsed,
  appendSignalEvent,
  getSignalEvents,
} from "./userProfile";

const SAMPLE_PROFILE: DerivedProfile = {
  genreVector: [
    { tag: "shoegaze", weight: 42, fromArtists: ["Slowdive", "Ride"] },
    { tag: "dream pop", weight: 17, fromArtists: ["Beach House"] },
  ],
  artistTags: [
    {
      name: "Slowdive",
      viewCount: 30,
      tags: [{ name: "shoegaze", count: 100 }],
    },
  ],
  similarGraph: [
    {
      seedArtist: "Slowdive",
      seedMbid: "mbid-slowdive",
      seedGenres: ["shoegaze", "dream pop"],
      viewCount: 30,
      candidates: [
        {
          name: "Cocteau Twins",
          artistMbid: "mbid-cocteau",
          score: 0.9,
          genres: ["ethereal wave", "dream pop"],
        },
      ],
    },
  ],
  explorationHistory: {
    albums: ["mbid-album-1", "mbid-album-2"],
    artists: ["mbid-artist-1"],
  },
};

const CONFIG_INPUTS = {
  genericTags: ["seen live", "favorites"],
  tagsPerArtist: 5,
  playTrendWindowDays: 90,
  ratingWeight: 0.5,
  distributionWeight: 0.5,
  minPlaysForDistribution: 5,
  minAvailableTracksForDistribution: 3,
  topArtistsCount: 10,
  exploreCandidateCount: 12,
};

async function createUser(username: string): Promise<number> {
  await getDataSource().query("INSERT INTO users (username) VALUES (?)", [
    username,
  ]);
  const [{ id }] = (await getDataSource().query(
    "SELECT id FROM users WHERE username = ?",
    [username]
  )) as { id: number }[];
  return id;
}

beforeEach(async () => {
  await initializeDatabase(":memory:");
});

afterEach(async () => {
  await closeDatabase();
});

describe("serializeDerivedProfile / parseDerivedProfile", () => {
  it("round-trips a profile", () => {
    const json = serializeDerivedProfile(SAMPLE_PROFILE);
    expect(parseDerivedProfile(json)).toEqual(SAMPLE_PROFILE);
  });

  it("returns an empty profile for invalid JSON", () => {
    expect(parseDerivedProfile("not json")).toEqual({
      genreVector: [],
      artistTags: [],
      similarGraph: [],
      explorationHistory: { albums: [], artists: [] },
    });
  });

  it("fills missing fields with empty defaults", () => {
    expect(parseDerivedProfile(JSON.stringify({ genreVector: [] }))).toEqual({
      genreVector: [],
      artistTags: [],
      similarGraph: [],
      explorationHistory: { albums: [], artists: [] },
    });
  });
});

describe("computeConfigHash", () => {
  it("is stable for the same inputs", () => {
    expect(computeConfigHash(CONFIG_INPUTS)).toBe(
      computeConfigHash(CONFIG_INPUTS)
    );
  });

  it("is insensitive to genericTags order and case", () => {
    expect(
      computeConfigHash({
        ...CONFIG_INPUTS,
        genericTags: ["Favorites", "SEEN live"],
      })
    ).toBe(computeConfigHash(CONFIG_INPUTS));
  });

  it("changes when a shaping field changes", () => {
    expect(computeConfigHash({ ...CONFIG_INPUTS, tagsPerArtist: 6 })).not.toBe(
      computeConfigHash(CONFIG_INPUTS)
    );
    expect(
      computeConfigHash({ ...CONFIG_INPUTS, playTrendWindowDays: 30 })
    ).not.toBe(computeConfigHash(CONFIG_INPUTS));
    expect(
      computeConfigHash({ ...CONFIG_INPUTS, distributionWeight: 0 })
    ).not.toBe(computeConfigHash(CONFIG_INPUTS));
    expect(
      computeConfigHash({ ...CONFIG_INPUTS, minPlaysForDistribution: 10 })
    ).not.toBe(computeConfigHash(CONFIG_INPUTS));
    expect(
      computeConfigHash({
        ...CONFIG_INPUTS,
        minAvailableTracksForDistribution: 0,
      })
    ).not.toBe(computeConfigHash(CONFIG_INPUTS));
  });

  it("ignores fields that are applied at selection time, not to the profile", () => {
    expect(
      computeConfigHash({
        ...CONFIG_INPUTS,
        pickedArtistsCount: 9,
      } as typeof CONFIG_INPUTS)
    ).toBe(computeConfigHash(CONFIG_INPUTS));
  });

  it("changes when a graph-shaping field changes", () => {
    expect(
      computeConfigHash({ ...CONFIG_INPUTS, topArtistsCount: 20 })
    ).not.toBe(computeConfigHash(CONFIG_INPUTS));
    expect(
      computeConfigHash({ ...CONFIG_INPUTS, exploreCandidateCount: 6 })
    ).not.toBe(computeConfigHash(CONFIG_INPUTS));
  });
});

describe("upsertUserProfile / getUserProfile", () => {
  it("returns null when no profile exists", async () => {
    const userId = await createUser("alice");
    expect(await getUserProfile(userId)).toBeNull();
  });

  it("creates a profile then reads it back", async () => {
    const userId = await createUser("alice");
    const hash = computeConfigHash(CONFIG_INPUTS);

    await upsertUserProfile(userId, SAMPLE_PROFILE, hash);

    const row = await getUserProfile(userId);
    expect(row).not.toBeNull();
    expect(row!.user_id).toBe(userId);
    expect(row!.config_hash).toBe(hash);
    expect(row!.schema_version).toBe(DERIVED_PROFILE_SCHEMA_VERSION);
    expect(parseDerivedProfile(row!.profile_json)).toEqual(SAMPLE_PROFILE);
  });

  it("updates the existing row instead of inserting a second one", async () => {
    const userId = await createUser("alice");
    await upsertUserProfile(userId, SAMPLE_PROFILE, "hash-1");

    const updated: DerivedProfile = {
      genreVector: [{ tag: "techno", weight: 9, fromArtists: ["Aphex Twin"] }],
      artistTags: [],
      similarGraph: [],
      explorationHistory: { albums: [], artists: [] },
    };
    await upsertUserProfile(userId, updated, "hash-2");

    const rows = await getDataSource().query(
      "SELECT * FROM user_profiles WHERE user_id = ?",
      [userId]
    );
    expect(rows).toHaveLength(1);

    const row = await getUserProfile(userId);
    expect(row!.config_hash).toBe("hash-2");
    expect(parseDerivedProfile(row!.profile_json)).toEqual(updated);
  });
});

describe("touchProfileUsed", () => {
  it("advances last_used_at without changing generated_at", async () => {
    const userId = await createUser("alice");
    await upsertUserProfile(userId, SAMPLE_PROFILE, "hash");
    const before = await getUserProfile(userId);

    await getDataSource().query(
      "UPDATE user_profiles SET last_used_at = ? WHERE user_id = ?",
      ["2000-01-01T00:00:00.000Z", userId]
    );
    await touchProfileUsed(userId);

    const after = await getUserProfile(userId);
    expect(after!.last_used_at).not.toBe("2000-01-01T00:00:00.000Z");
    expect(after!.generated_at).toBe(before!.generated_at);
  });
});

describe("appendSignalEvent / getSignalEvents", () => {
  it("appends and reads back events for a user", async () => {
    const userId = await createUser("alice");
    await appendSignalEvent(userId, "plex_plays", { artists: 3 });

    const events = await getSignalEvents(userId);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("plex_plays");
    expect(JSON.parse(events[0].payload)).toEqual({ artists: 3 });
  });

  it("filters by kind", async () => {
    const userId = await createUser("alice");
    await appendSignalEvent(userId, "plex_plays", {});
    await appendSignalEvent(userId, "plex_rating", { rating: 8 });
    await appendSignalEvent(userId, "plex_plays", {});

    expect(await getSignalEvents(userId, "plex_plays")).toHaveLength(2);
    expect(await getSignalEvents(userId, "plex_rating")).toHaveLength(1);
  });

  it("scopes events to the owning user", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");
    await appendSignalEvent(alice, "plex_plays", {});
    await appendSignalEvent(bob, "plex_plays", {});

    expect(await getSignalEvents(alice)).toHaveLength(1);
    expect(await getSignalEvents(bob)).toHaveLength(1);
  });
});
