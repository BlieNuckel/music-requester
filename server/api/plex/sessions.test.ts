import { describe, it, expect, vi, beforeEach } from "vitest";
import { getActiveSessions } from "./sessions";

vi.mock("./config", () => ({
  getPlexConfig: vi.fn(() => ({
    baseUrl: "http://plex:32400",
    headers: { "X-Plex-Token": "tok", Accept: "application/json" },
    token: "tok",
  })),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

function okResponse(data: unknown) {
  return { ok: true, json: () => Promise.resolve(data) };
}

const rawSession = {
  sessionKey: "12",
  ratingKey: "451",
  type: "track",
  title: "Antwerp Expo",
  parentRatingKey: "alb1",
  parentTitle: "Live Sets",
  grandparentRatingKey: "art1",
  grandparentTitle: "Andromedik",
  duration: 5_448_000,
  viewOffset: 150_000,
  Player: {
    state: "playing",
    machineIdentifier: "device-1",
    product: "Plexamp",
  },
  User: { id: "1" },
};

describe("getActiveSessions", () => {
  it("maps a playing track onto its album and artist", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ MediaContainer: { size: 1, Metadata: [rawSession] } })
    );

    const result = await getActiveSessions("tok");

    expect(result).toEqual([
      {
        sessionKey: "12",
        ratingKey: "451",
        title: "Antwerp Expo",
        artistKey: "art1",
        artistName: "Andromedik",
        albumKey: "alb1",
        albumTitle: "Live Sets",
        durationMs: 5_448_000,
        viewOffsetMs: 150_000,
        machineIdentifier: "device-1",
        product: "Plexamp",
        state: "playing",
      },
    ]);
    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://plex:32400/status/sessions"
    );
  });

  it("keeps a paused session, which is still a window in flight", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        MediaContainer: {
          Metadata: [
            {
              ...rawSession,
              Player: { ...rawSession.Player, state: "paused" },
            },
          ],
        },
      })
    );

    expect(await getActiveSessions("tok")).toHaveLength(1);
  });

  it("ignores anything that is not a music track", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        MediaContainer: {
          Metadata: [rawSession, { ...rawSession, type: "episode" }],
        },
      })
    );

    expect(await getActiveSessions("tok")).toHaveLength(1);
  });

  it("ignores a row with no playback position to measure", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        MediaContainer: {
          Metadata: [{ ...rawSession, viewOffset: undefined }],
        },
      })
    );

    expect(await getActiveSessions("tok")).toEqual([]);
  });

  it("returns nothing when no one is listening", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ MediaContainer: { size: 0 } })
    );

    expect(await getActiveSessions("tok")).toEqual([]);
  });

  it("throws when Plex rejects the request", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    await expect(getActiveSessions("tok")).rejects.toThrow("Plex returned 401");
  });
});
