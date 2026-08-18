import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindArtistResolution = vi.fn();
const mockListArtistResolutions = vi.fn();

vi.mock("../../db/liveEvents", () => ({
  findArtistResolution: (...args: unknown[]) =>
    mockFindArtistResolution(...args),
  listArtistResolutions: () => mockListArtistResolutions(),
}));

const { deriveLiveTracking, getArtistLiveTracking, countLiveTracking } =
  await import("./tracking");

function resolution(
  jambaseArtistId: string | null,
  resolvedAt: string | null,
  follows = 1
) {
  return {
    follows,
    jambase_artist_id: jambaseArtistId,
    jambase_resolved_at: resolvedAt,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deriveLiveTracking", () => {
  it("calls an unattempted artist pending", () => {
    expect(deriveLiveTracking(resolution(null, null))).toBe("pending");
  });

  it("calls a resolved artist tracked", () => {
    expect(
      deriveLiveTracking(resolution("jambase:1", "2026-08-01T00:00:00.000Z"))
    ).toBe("tracked");
  });

  it("calls a confirmed miss unavailable", () => {
    expect(
      deriveLiveTracking(resolution(null, "2026-08-01T00:00:00.000Z"))
    ).toBe("unavailable");
  });

  it("trusts an id even without a timestamp, since the id is the answer", () => {
    expect(deriveLiveTracking(resolution("jambase:1", null))).toBe("tracked");
  });
});

describe("getArtistLiveTracking", () => {
  it("returns null when nobody follows the artist", async () => {
    mockFindArtistResolution.mockResolvedValue(resolution(null, null, 0));
    expect(await getArtistLiveTracking("mbid")).toBeNull();
  });

  it("returns the state for a followed artist", async () => {
    mockFindArtistResolution.mockResolvedValue(
      resolution(null, "2026-08-01T00:00:00.000Z")
    );
    expect(await getArtistLiveTracking("mbid")).toBe("unavailable");
  });

  it("asks about the MBID it was given", async () => {
    mockFindArtistResolution.mockResolvedValue(resolution(null, null, 0));
    await getArtistLiveTracking("abc-123");
    expect(mockFindArtistResolution).toHaveBeenCalledWith("abc-123");
  });
});

describe("countLiveTracking", () => {
  it("counts each state", async () => {
    mockListArtistResolutions.mockResolvedValue([
      resolution("jambase:1", "2026-08-01T00:00:00.000Z"),
      resolution("jambase:2", "2026-08-01T00:00:00.000Z"),
      resolution(null, null),
      resolution(null, "2026-08-01T00:00:00.000Z"),
    ]);

    expect(await countLiveTracking()).toEqual({
      tracked: 2,
      pending: 1,
      unavailable: 1,
    });
  });

  it("reports zeroes for an empty roster rather than an empty object", async () => {
    mockListArtistResolutions.mockResolvedValue([]);

    expect(await countLiveTracking()).toEqual({
      tracked: 0,
      pending: 0,
      unavailable: 0,
    });
  });
});
