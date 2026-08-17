import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelectNotice = vi.fn();
const mockFindAllForUser = vi.fn();
const mockSetUserResponse = vi.fn();
const mockMarkViewed = vi.fn();
const mockFindEventsForArtist = vi.fn();
const mockFindJambaseId = vi.fn();

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

    const res = await request(app).get("/artist/mbid-unknown");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ events: [] });
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
