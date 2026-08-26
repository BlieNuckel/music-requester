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

  /**
   * Empty today: the knob that was on its way out has left the settings entirely. The field
   * stays because the mechanism is what lets a knob outlive the step that read it, for as
   * long as the running pipeline still consults it.
   */
  it("carries no retired knobs while none are on their way out", async () => {
    const res = await request(app).get("/graph");

    expect(res.body.retiredParams).toEqual([]);
  });

  it("says the recommender runs every node it draws", async () => {
    const res = await request(app).get("/graph");

    expect(
      res.body.nodes.filter((n: { status: string }) => n.status === "ported")
    ).toEqual([]);
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

describe("GET /graph/spotlight", () => {
  it("draws the flow a recommendation's trace hangs on, with its boundary", async () => {
    const res = await request(app).get("/graph/spotlight");
    const ids = res.body.nodes.map((n: { id: string }) => n.id);

    expect(res.status).toBe(200);
    expect(ids).toContain("sourceChain");
    expect(ids).toContain("pickLoop");
    // The profile the picks read is another flow's, and shows as a boundary reference.
    expect(ids).toContain("profileFreshness");
    expect(ids).not.toContain("listeningWindow");
  });

  /**
   * Anyone shown a recommendation can ask why. The settings canvas is a different question,
   * and stays behind ADMIN, so this answer carries the shape without the dials.
   */
  it("carries no knobs, so asking why is not asking for the settings", async () => {
    const res = await request(app).get("/graph/spotlight");

    for (const node of res.body.nodes) {
      expect([node.id, node.params, node.usesParams]).toEqual([
        node.id,
        [],
        [],
      ]);
    }
    expect(res.body.retiredParams).toEqual([]);
  });

  it("still says what each step takes, does and gives", async () => {
    const res = await request(app).get("/graph/spotlight");
    const walk = res.body.nodes.find(
      (n: { id: string }) => n.id === "candidateWalk"
    );

    expect(walk.takes.length).toBeGreaterThan(0);
    expect(walk.does.length).toBeGreaterThan(0);
    expect(walk.gives.length).toBeGreaterThan(0);
  });

  it("names the allowance a trace reports what is left of", async () => {
    const res = await request(app).get("/graph/spotlight");

    expect(res.body.budgets).toContainEqual(
      expect.objectContaining({ id: "resolutionBudget" })
    );
  });
});
