import { describe, it, expect, vi } from "vitest";

const { permissionCalls } = vi.hoisted(() => ({
  permissionCalls: [] as number[],
}));

vi.mock("../middleware/requireAuth", () => ({
  requireAuth: (
    req: { user: unknown },
    _res: unknown,
    next: () => void
  ): void => {
    req.user = { id: 1, permissions: 1, username: "admin" };
    next();
  },
}));

vi.mock("../middleware/requirePermission", () => ({
  requirePermission: (permission: number) => {
    permissionCalls.push(permission);
    return (_req: unknown, _res: unknown, next: () => void) => next();
  },
}));

import express from "express";
import request from "supertest";
import recommendationsRouter from "./recommendations";
import { Permission } from "../../shared/permissions";

const app = express();
app.use("/", recommendationsRouter);

describe("GET /graph", () => {
  it("is gated on ADMIN", () => {
    expect(permissionCalls).toContain(Permission.ADMIN);
  });

  it("returns nodes, edges and budgets", async () => {
    const res = await request(app).get("/graph");

    expect(res.status).toBe(200);
    expect(res.body.nodes.length).toBeGreaterThan(0);
    expect(res.body.edges.length).toBeGreaterThan(0);
    expect(res.body.budgets.length).toBeGreaterThan(0);
  });

  it("carries resolved param definitions rather than bare keys", async () => {
    const res = await request(app).get("/graph");
    const node = res.body.nodes.find(
      (n: { id: string }) => n.id === "weightAdjust"
    );

    expect(node.params).toContainEqual(
      expect.objectContaining({
        key: "ratingWeight",
        label: "Rating weight",
        kind: "factor",
      })
    );
  });

  it("carries the knobs no node reads any more, with their reason", async () => {
    const res = await request(app).get("/graph");

    expect(res.body.retiredParams).toContainEqual(
      expect.objectContaining({
        key: "minAvailableTracksForDistribution",
        reason: expect.any(String),
      })
    );
  });

  it("says which nodes the recommender does not run yet", async () => {
    const res = await request(app).get("/graph");
    const ported = res.body.nodes.filter(
      (n: { status: string }) => n.status === "ported"
    );

    expect(ported.length).toBeGreaterThan(0);
    for (const node of ported) {
      expect(node.module).toEqual(expect.any(String));
    }
  });

  it("carries no settings values, which the client already holds", async () => {
    const res = await request(app).get("/graph");

    for (const node of res.body.nodes) {
      for (const param of node.params) {
        expect(param).not.toHaveProperty("value");
      }
    }
  });
});
