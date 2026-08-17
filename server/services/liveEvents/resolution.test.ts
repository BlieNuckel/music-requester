import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveArtistByMbid = vi.fn();
const mockIsConfigured = vi.fn();
const mockFindUnresolved = vi.fn();
const mockSetJambaseArtistId = vi.fn();

vi.mock("../../api/jambase/artists", () => ({
  resolveArtistByMbid: (...args: unknown[]) => mockResolveArtistByMbid(...args),
}));

vi.mock("../../api/jambase/config", async () => {
  const actual = await vi.importActual<
    typeof import("../../api/jambase/config")
  >("../../api/jambase/config");
  return {
    ...actual,
    isLiveEventsConfigured: () => mockIsConfigured(),
  };
});

vi.mock("../../db/liveEvents", () => ({
  findUnresolvedFollowedArtists: (...args: unknown[]) =>
    mockFindUnresolved(...args),
  setJambaseArtistId: (...args: unknown[]) => mockSetJambaseArtistId(...args),
}));

const { resolveFollowedArtists } = await import("./resolution");
const { JambaseError } = await import("../../api/jambase/config");

function artist(id: number, name: string) {
  return { id, artist_mbid: `mbid-${id}`, artist_name: name };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsConfigured.mockReturnValue(true);
  mockFindUnresolved.mockResolvedValue([]);
});

describe("resolveFollowedArtists", () => {
  it("does nothing when live events are not configured", async () => {
    mockIsConfigured.mockReturnValue(false);

    const outcome = await resolveFollowedArtists(10);

    expect(outcome.attempted).toBe(0);
    expect(mockFindUnresolved).not.toHaveBeenCalled();
    expect(mockResolveArtistByMbid).not.toHaveBeenCalled();
  });

  it("stores a resolved JamBase id", async () => {
    mockFindUnresolved.mockResolvedValue([artist(1, "Yves Tumor")]);
    mockResolveArtistByMbid.mockResolvedValue({
      jambaseArtistId: "jambase:219057",
    });

    const outcome = await resolveFollowedArtists(10);

    expect(outcome).toMatchObject({ attempted: 1, resolved: 1, missing: 0 });
    expect(mockSetJambaseArtistId).toHaveBeenCalledWith(
      1,
      "jambase:219057",
      expect.any(String)
    );
  });

  it("records a confirmed miss so the artist leaves the queue", async () => {
    mockFindUnresolved.mockResolvedValue([artist(1, "Obscure")]);
    mockResolveArtistByMbid.mockResolvedValue(null);

    const outcome = await resolveFollowedArtists(10);

    expect(outcome).toMatchObject({ resolved: 0, missing: 1 });
    expect(mockSetJambaseArtistId).toHaveBeenCalledWith(
      1,
      null,
      expect.any(String)
    );
  });

  it("records nothing on a transient failure, so the next run retries", async () => {
    mockFindUnresolved.mockResolvedValue([artist(1, "Flaky")]);
    mockResolveArtistByMbid.mockRejectedValue(
      new JambaseError("transient", "503", 503)
    );

    const outcome = await resolveFollowedArtists(10);

    expect(outcome).toMatchObject({ attempted: 1, failed: 1 });
    expect(mockSetJambaseArtistId).not.toHaveBeenCalled();
  });

  it("keeps going after one artist fails transiently", async () => {
    mockFindUnresolved.mockResolvedValue([artist(1, "A"), artist(2, "B")]);
    mockResolveArtistByMbid
      .mockRejectedValueOnce(new JambaseError("transient", "503", 503))
      .mockResolvedValueOnce({ jambaseArtistId: "jambase:2" });

    const outcome = await resolveFollowedArtists(10);

    expect(outcome).toMatchObject({ attempted: 2, resolved: 1, failed: 1 });
  });

  it("stops the batch on a plan gate rather than spending a call per artist", async () => {
    mockFindUnresolved.mockResolvedValue([
      artist(1, "A"),
      artist(2, "B"),
      artist(3, "C"),
    ]);
    mockResolveArtistByMbid.mockRejectedValue(
      new JambaseError("plan-gated", "not on your plan", 403)
    );

    const outcome = await resolveFollowedArtists(10);

    expect(outcome.attempted).toBe(1);
    expect(mockResolveArtistByMbid).toHaveBeenCalledTimes(1);
  });

  it("stops the batch on a rejected key", async () => {
    mockFindUnresolved.mockResolvedValue([artist(1, "A"), artist(2, "B")]);
    mockResolveArtistByMbid.mockRejectedValue(
      new JambaseError("unauthorized", "bad key", 401)
    );

    await resolveFollowedArtists(10);

    expect(mockResolveArtistByMbid).toHaveBeenCalledTimes(1);
  });

  it("passes the limit through, so a big import cannot drain the quota", async () => {
    await resolveFollowedArtists(25);
    expect(mockFindUnresolved).toHaveBeenCalledWith(25);
  });
});
