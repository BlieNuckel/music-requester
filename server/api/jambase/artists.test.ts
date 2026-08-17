import { describe, it, expect, vi, beforeEach } from "vitest";

const mockJambaseGet = vi.fn();

vi.mock("./fetch", () => ({
  jambaseGet: (...args: unknown[]) => mockJambaseGet(...args),
}));

const { resolveArtistByMbid } = await import("./artists");
const { JambaseError } = await import("./config");

const RADIOHEAD_MBID = "a74b1b7f-71a5-4011-9441-d0b5e4122711";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveArtistByMbid", () => {
  it("resolves an MBID to a JamBase artist id", async () => {
    mockJambaseGet.mockResolvedValue({
      success: true,
      artist: {
        name: "Radiohead",
        identifier: "jambase:219057",
        genre: ["indie", "rock"],
        "x-numUpcomingEvents": 0,
      },
    });

    const artist = await resolveArtistByMbid(RADIOHEAD_MBID);

    expect(artist).toEqual({
      jambaseArtistId: "jambase:219057",
      name: "Radiohead",
      genres: ["indie", "rock"],
      numUpcomingEvents: 0,
      events: [],
    });
    expect(mockJambaseGet.mock.calls[0][0]).toBe(
      `/artists/id/musicbrainz:${RADIOHEAD_MBID}`
    );
  });

  it("only asks for events when told to", async () => {
    mockJambaseGet.mockResolvedValue({
      artist: { identifier: "jambase:1", name: "A" },
    });

    await resolveArtistByMbid(RADIOHEAD_MBID);
    expect(mockJambaseGet.mock.calls[0][1]).toEqual({});

    await resolveArtistByMbid(RADIOHEAD_MBID, { withEvents: true });
    expect(mockJambaseGet.mock.calls[1][1]).toEqual({
      expandUpcomingEvents: "true",
    });
  });

  it("normalizes the inline events", async () => {
    mockJambaseGet.mockResolvedValue({
      artist: {
        identifier: "jambase:1",
        name: "Yves Tumor",
        events: [
          {
            identifier: "jambase:100",
            name: "Show",
            startDate: "2026-08-30T19:00:00Z",
            eventStatus: "https://schema.org/EventScheduled",
            location: {
              name: "Amiralen",
              address: { addressLocality: "Malmö", addressCountry: "SE" },
              geo: { latitude: 55.605, longitude: 13.0038 },
            },
          },
        ],
      },
    });

    const artist = await resolveArtistByMbid(RADIOHEAD_MBID, {
      withEvents: true,
    });
    expect(artist?.events).toHaveLength(1);
    expect(artist?.events[0].event_key).toBe("jambase:100");
    expect(artist?.events[0].venue_city).toBe("Malmö");
  });

  it("returns null on 404, which is a real answer about the artist", async () => {
    mockJambaseGet.mockRejectedValue(
      new JambaseError("not-found", "no such entity", 404)
    );

    expect(await resolveArtistByMbid(RADIOHEAD_MBID)).toBeNull();
  });

  it("returns null when the payload carries no identifier to key off", async () => {
    mockJambaseGet.mockResolvedValue({ success: true, artist: null });
    expect(await resolveArtistByMbid(RADIOHEAD_MBID)).toBeNull();

    mockJambaseGet.mockResolvedValue({ artist: { name: "Nameless" } });
    expect(await resolveArtistByMbid(RADIOHEAD_MBID)).toBeNull();
  });

  it("rethrows anything that is not a miss, so a plan gate is not read as absence", async () => {
    mockJambaseGet.mockRejectedValue(
      new JambaseError("plan-gated", "not on your plan", 403)
    );

    await expect(resolveArtistByMbid(RADIOHEAD_MBID)).rejects.toMatchObject({
      kind: "plan-gated",
    });
  });

  it("rethrows a transient failure rather than recording a miss", async () => {
    mockJambaseGet.mockRejectedValue(
      new JambaseError("transient", "JamBase returned 503", 503)
    );

    await expect(resolveArtistByMbid(RADIOHEAD_MBID)).rejects.toMatchObject({
      kind: "transient",
    });
  });

  it("encodes the mbid into the path", async () => {
    mockJambaseGet.mockResolvedValue({ artist: { identifier: "jambase:1" } });
    await resolveArtistByMbid("weird id/../x");
    expect(mockJambaseGet.mock.calls[0][0]).toBe(
      "/artists/id/musicbrainz:weird%20id%2F..%2Fx"
    );
  });
});
