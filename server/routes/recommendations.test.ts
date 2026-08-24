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
      (n: { id: string }) => n.id === "ratingMultiplier"
    );

    expect(node.params).toEqual([
      expect.objectContaining({
        key: "ratingWeight",
        label: "Rating weight",
        kind: "int",
      }),
    ]);
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
