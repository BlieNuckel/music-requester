import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelectNotice = vi.fn();
const mockFindAllForUser = vi.fn();
const mockSetUserResponse = vi.fn();
const mockMarkViewed = vi.fn();
const mockFindEventsForArtist = vi.fn();
const mockFindJambaseId = vi.fn();
const mockReadPreferences = vi.fn();
const mockWritePreferences = vi.fn();
const mockSearchPlaces = vi.fn();
const mockCountLiveTracking = vi.fn();
const mockGetArtistLiveTracking = vi.fn();

vi.mock("../services/liveEvents/notice", () => ({
  selectNotice: (...args: unknown[]) => mockSelectNotice(...args),
}));

vi.mock("../db/liveEvents", () => ({
  findAllForUser: (...args: unknown[]) => mockFindAllForUser(...args),
  setUserResponse: (...args: unknown[]) => mockSetUserResponse(...args),
  markViewed: (...args: unknown[]) => mockMarkViewed(...args),
  findEventsForArtist: (...args: unknown[]) => mockFindEventsForArtist(...args),
  findJambaseIdForArtistMbid: (...args: unknown[]) =>
    mockFindJambaseId(...args),
}));

vi.mock("../services/liveEvents/preferences", () => ({
  readLivePreferences: (...args: unknown[]) => mockReadPreferences(...args),
  writeLivePreferences: (...args: unknown[]) => mockWritePreferences(...args),
}));

vi.mock("../api/openMeteo/geocoding", () => ({
  searchPlaces: (...args: unknown[]) => mockSearchPlaces(...args),
}));

vi.mock("../services/liveEvents/tracking", () => ({
  countLiveTracking: () => mockCountLiveTracking(),
  getArtistLiveTracking: (...args: unknown[]) =>
    mockGetArtistLiveTracking(...args),
}));

vi.mock("../middleware/requireAuth", () => ({
  requireAuth: (req: { user: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 7, permissions: 9, username: "lasse" };
    next();
  },
}));

import express from "express";
import request from "supertest";
import liveRouter from "./live";
import { ApiError } from "../middleware/ApiError";

const app = express();
app.use(express.json());
app.use("/", liveRouter);
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    const status = err instanceof ApiError ? err.status : 500;
    res.status(status).json({ error: err.message });
  }
);

function storedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    event_key: "jambase:100",
    name: "Yves Tumor at Amiralen",
    event_date: "2026-08-30",
    previous_start_date: null,
    event_status: "scheduled",
    status_changed_at: null,
    venue_name: "Amiralen",
    venue_city: "Malmö",
    venue_country: "SE",
    ticket_url: "https://tickets.test/100",
    image_url: null,
    distanceKm: 2.4,
    performers: [
      {
        artist_jambase_id: "jambase:1",
        artist_name: "Yves Tumor",
        is_headliner: true,
      },
    ],
    state: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectNotice.mockResolvedValue({ notice: null, additionalCount: 0 });
  mockFindAllForUser.mockResolvedValue([]);
  mockSetUserResponse.mockResolvedValue({});
  mockMarkViewed.mockResolvedValue({});
  mockFindEventsForArtist.mockResolvedValue([]);
  mockFindJambaseId.mockResolvedValue(null);
  mockGetArtistLiveTracking.mockResolvedValue(null);
  mockCountLiveTracking.mockResolvedValue({
    tracked: 0,
    pending: 0,
    unavailable: 0,
  });
  mockReadPreferences.mockResolvedValue({ preferences: {}, coverage: {} });
  mockWritePreferences.mockResolvedValue({ preferences: {}, coverage: {} });
});

describe("GET /notice", () => {
  it("returns null with no count when nothing qualifies", async () => {
    const res = await request(app).get("/notice");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ notice: null, additionalCount: 0 });
  });

  it("serializes the notice with its tier and reason", async () => {
    mockSelectNotice.mockResolvedValue({
      notice: {
        event: storedEvent(),
        tier: "local",
        reason: "coming-up",
        distanceKm: 2.4,
        score: 1200,
      },
      additionalCount: 2,
    });

    const res = await request(app).get("/notice");

    expect(res.status).toBe(200);
    expect(res.body.additionalCount).toBe(2);
    expect(res.body.notice).toMatchObject({
      id: 1,
      name: "Yves Tumor at Amiralen",
      venueCity: "Malmö",
      ticketUrl: "https://tickets.test/100",
      tier: "local",
      reason: "coming-up",
      distanceKm: 2.4,
    });
    expect(res.body.notice.performers).toEqual([
      { jambaseId: "jambase:1", name: "Yves Tumor", isHeadliner: true },
    ]);
  });

  it("exposes the status fields the banner needs", async () => {
    mockSelectNotice.mockResolvedValue({
      notice: {
        event: storedEvent({
          event_status: "rescheduled",
          previous_start_date: "2026-07-01",
          status_changed_at: "2026-08-16T00:00:00.000Z",
        }),
        tier: "local",
        reason: "status-changed",
        distanceKm: 2.4,
        score: 11200,
      },
      additionalCount: 0,
    });

    const res = await request(app).get("/notice");

    expect(res.body.notice.status).toBe("rescheduled");
    expect(res.body.notice.previousStartDate).toBe("2026-07-01");
  });

  it("asks only for the signed-in user's notice", async () => {
    await request(app).get("/notice");
    expect(mockSelectNotice).toHaveBeenCalledWith(7);
  });
});

describe("GET /events", () => {
  it("returns upcoming events by default", async () => {
    mockFindAllForUser.mockResolvedValue([storedEvent()]);

    const res = await request(app).get("/events");

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(mockFindAllForUser.mock.calls[0][1]).toMatchObject({ past: false });
  });

  it("passes the past flag through", async () => {
    await request(app).get("/events?past=true");
    expect(mockFindAllForUser.mock.calls[0][1]).toMatchObject({ past: true });
  });

  it("passes a valid response filter through", async () => {
    await request(app).get("/events?response=going");
    expect(mockFindAllForUser.mock.calls[0][1]).toMatchObject({
      response: "going",
    });
  });

  it("rejects an unknown response filter", async () => {
    const res = await request(app).get("/events?response=maybe");

    expect(res.status).toBe(400);
    expect(mockFindAllForUser).not.toHaveBeenCalled();
  });

  it("omits the filter entirely when none is given", async () => {
    await request(app).get("/events");
    expect(mockFindAllForUser.mock.calls[0][1]).not.toHaveProperty("response");
  });
});

describe("POST /events/:id/response", () => {
  it("records going", async () => {
    const res = await request(app)
      .post("/events/12/response")
      .send({ response: "going" });

    expect(res.status).toBe(200);
    expect(mockSetUserResponse).toHaveBeenCalledWith(
      7,
      12,
      "going",
      expect.any(String)
    );
  });

  it("records a dismissal", async () => {
    await request(app)
      .post("/events/12/response")
      .send({ response: "dismissed" });
    expect(mockSetUserResponse).toHaveBeenCalledWith(
      7,
      12,
      "dismissed",
      expect.any(String)
    );
  });

  it("clears a response when given null", async () => {
    await request(app).post("/events/12/response").send({ response: null });
    expect(mockSetUserResponse).toHaveBeenCalledWith(
      7,
      12,
      null,
      expect.any(String)
    );
  });

  it("rejects an unknown response", async () => {
    const res = await request(app)
      .post("/events/12/response")
      .send({ response: "perhaps" });

    expect(res.status).toBe(400);
    expect(mockSetUserResponse).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric event id", async () => {
    const res = await request(app)
      .post("/events/abc/response")
      .send({ response: "going" });

    expect(res.status).toBe(400);
    expect(mockSetUserResponse).not.toHaveBeenCalled();
  });
});

describe("POST /events/:id/viewed", () => {
  it("marks the event seen for this user", async () => {
    const res = await request(app).post("/events/12/viewed");

    expect(res.status).toBe(200);
    expect(mockMarkViewed).toHaveBeenCalledWith(7, 12, expect.any(String));
  });

  it("rejects a bad id", async () => {
    const res = await request(app).post("/events/0/viewed");
    expect(res.status).toBe(400);
  });
});

describe("GET /artist/:mbid", () => {
  it("reports the tracking state alongside the dates", async () => {
    mockGetArtistLiveTracking.mockResolvedValue("unavailable");

    const res = await request(app).get("/artist/mbid-1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ events: [], liveTracking: "unavailable" });
    expect(mockGetArtistLiveTracking).toHaveBeenCalledWith("mbid-1");
  });

  it("reports null tracking for an artist nobody follows", async () => {
    const res = await request(app).get("/artist/mbid-1");
    expect(res.body.liveTracking).toBeNull();
  });

  it("keeps the tracking state on a response that does have dates", async () => {
    mockFindJambaseId.mockResolvedValue("jambase:1");
    mockGetArtistLiveTracking.mockResolvedValue("tracked");
    mockFindEventsForArtist.mockResolvedValue([storedEvent()]);

    const res = await request(app).get("/artist/mbid-1");

    expect(res.body.events).toHaveLength(1);
    expect(res.body.liveTracking).toBe("tracked");
  });

  it("returns the artist's dates once they have been resolved", async () => {
    mockFindJambaseId.mockResolvedValue("jambase:1");
    mockFindEventsForArtist.mockResolvedValue([storedEvent()]);

    const res = await request(app).get("/artist/mbid-yves");

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(mockFindEventsForArtist).toHaveBeenCalledWith(
      7,
      "jambase:1",
      expect.objectContaining({ includePast: false })
    );
  });

  it("returns an empty list rather than an error for an unresolved artist", async () => {
    mockFindJambaseId.mockResolvedValue(null);
    mockReadPreferences.mockResolvedValue({ preferences: {}, coverage: {} });
    mockWritePreferences.mockResolvedValue({ preferences: {}, coverage: {} });

    const res = await request(app).get("/artist/mbid-unknown");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ events: [], liveTracking: null });
    expect(mockFindEventsForArtist).not.toHaveBeenCalled();
  });

  it("passes includePast through", async () => {
    mockFindJambaseId.mockResolvedValue("jambase:1");
    await request(app).get("/artist/mbid-yves?includePast=true");

    expect(mockFindEventsForArtist).toHaveBeenCalledWith(
      7,
      "jambase:1",
      expect.objectContaining({ includePast: true })
    );
  });
});

describe("preferences", () => {
  it("returns preferences with the coverage disclosure", async () => {
    mockReadPreferences.mockResolvedValue({
      preferences: { live_radius_km: 40 },
      coverage: { sweepRadiusKm: 150 },
    });

    const res = await request(app).get("/preferences");

    expect(res.status).toBe(200);
    expect(res.body.coverage.sweepRadiusKm).toBe(150);
    expect(mockReadPreferences).toHaveBeenCalledWith(7);
  });

  it("patches only the caller's own preferences", async () => {
    mockWritePreferences.mockResolvedValue({ preferences: {}, coverage: {} });

    const res = await request(app).patch("/preferences").send({ radiusKm: 40 });

    expect(res.status).toBe(200);
    expect(mockWritePreferences).toHaveBeenCalledWith(7, { radiusKm: 40 });
  });

  it("surfaces a rejected patch with its status", async () => {
    mockWritePreferences.mockRejectedValue(
      new ApiError(400, "Use GB rather than UK for the United Kingdom")
    );

    const res = await request(app)
      .patch("/preferences")
      .send({ regions: ["UK"] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("GB");
  });
});

describe("GET /geocode", () => {
  it("hands back what the geocoder matched", async () => {
    mockSearchPlaces.mockResolvedValue([
      {
        name: "Malmö",
        region: "Skåne County",
        country: "Sweden",
        countryCode: "SE",
        latitude: 55.6059,
        longitude: 13.0007,
        population: 362133,
      },
    ]);

    const res = await request(app).get("/geocode?q=Malm%C3%B6");

    expect(res.status).toBe(200);
    expect(mockSearchPlaces).toHaveBeenCalledWith("Malmö");
    expect(res.body.places[0].name).toBe("Malmö");
  });

  it("treats a missing query as an empty one rather than a 500", async () => {
    mockSearchPlaces.mockResolvedValue([]);

    const res = await request(app).get("/geocode");

    expect(res.status).toBe(200);
    expect(mockSearchPlaces).toHaveBeenCalledWith("");
    expect(res.body).toEqual({ places: [] });
  });
});

describe("GET /roster", () => {
  it("returns the counts per resolution state", async () => {
    mockCountLiveTracking.mockResolvedValue({
      tracked: 12,
      pending: 3,
      unavailable: 1,
    });

    const res = await request(app).get("/roster");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tracked: 12, pending: 3, unavailable: 1 });
  });
});
