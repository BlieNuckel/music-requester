import { describe, it, expect, vi } from "vitest";
import { runGraph } from "./executor";
import { NODE_REGISTRY } from "../nodes";
import type { NodeBody } from "./executor";

type Ctx = { label: string };

/** Bodies for real node ids, so the wiring under test is the registry's own. */
function bodies(
  entries: Record<string, NodeBody<Ctx>>
): Map<string, NodeBody<Ctx>> {
  return new Map(Object.entries(entries));
}

const registered = (id: string) => NODE_REGISTRY.find((n) => n.id === id)!;

describe("runGraph", () => {
  it("resolves a node's inputs before running it", async () => {
    const order: string[] = [];
    const { outputs } = await runGraph(
      ["foldToNow"],
      bodies({
        plexCapture: () => "sweep",
        plexSessions: () => "sessions",
        signalLog: () => {
          order.push("signalLog");
          return "raw";
        },
        loadSignals: (inputs) => {
          order.push("loadSignals");
          return `${inputs.signalLog}+series`;
        },
        foldToNow: (inputs) => {
          order.push("foldToNow");
          return `${inputs.loadSignals}+folded`;
        },
      }),
      { label: "t" }
    );

    expect(order).toEqual(["signalLog", "loadSignals", "foldToNow"]);
    expect(outputs.get("foldToNow")).toBe("raw+series+folded");
  });

  it("runs a shared step once however many read it", async () => {
    const load = vi.fn(() => "raw");
    const inputsOf = (id: string) => registered(id).inputs.map((i) => i.from);

    expect(inputsOf("foldToNow")).toContain("loadSignals");
    expect(inputsOf("listeningWindow")).toContain("loadSignals");

    await runGraph(
      ["foldToNow", "listeningWindow"],
      bodies({
        plexCapture: () => "sweep",
        plexSessions: () => "sessions",
        signalLog: () => "log",
        loadSignals: load,
        foldToNow: () => "folded",
        listeningWindow: () => "window",
      }),
      { label: "t" }
    );

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("times each node and says the shape of what it produced", async () => {
    const { trace } = await runGraph(
      ["signalLog"],
      bodies({
        plexCapture: () => "sweep",
        plexSessions: () => "sessions",
        signalLog: () => [1, 2, 3],
      }),
      { label: "t" }
    );

    expect(trace[trace.length - 1]).toEqual({
      nodeId: "signalLog",
      ms: expect.any(Number),
      summary: "3 items",
    });
  });

  /**
   * A weighted draw is re-rolled per recommendation on purpose. Caching one would freeze a
   * single draw into every pick in the set, which is a whole carousel from one corner of
   * someone's taste.
   */
  it("re-runs a pick rather than freezing one draw", async () => {
    const draw = vi.fn(() => "artists");
    const { trace } = await runGraph(
      ["exploreQuota", "exploreQuota"],
      bodies({ exploreQuota: draw }),
      { label: "t" }
    );

    expect(registered("exploreQuota").scope).toBe("pick");
    expect(draw).toHaveBeenCalledTimes(2);
    expect(trace).toHaveLength(2);
  });

  it("still runs a profile step once when asked for twice", async () => {
    const fold = vi.fn(() => "folded");
    await runGraph(
      ["foldToNow", "foldToNow"],
      bodies({
        plexCapture: () => "sweep",
        plexSessions: () => "sessions",
        signalLog: () => "log",
        loadSignals: () => "series",
        foldToNow: fold,
      }),
      { label: "t" }
    );

    expect(registered("foldToNow").scope).toBe("profile");
    expect(fold).toHaveBeenCalledTimes(1);
  });

  it("refuses a node nothing is wired to", async () => {
    await expect(
      runGraph(["foldToNow"], bodies({ foldToNow: () => 1 }), { label: "t" })
    ).rejects.toThrow(/No body wired/);
  });

  it("refuses a node the registry does not declare", async () => {
    await expect(
      runGraph(["nonesuch"], bodies({}), { label: "t" })
    ).rejects.toThrow(/No node registered/);
  });

  it("hands every body the same context", async () => {
    const seen: string[] = [];
    await runGraph(
      ["signalLog"],
      bodies({
        plexCapture: (_i, ctx) => seen.push(ctx.label),
        plexSessions: (_i, ctx) => seen.push(ctx.label),
        signalLog: (_i, ctx) => seen.push(ctx.label),
      }),
      { label: "one-run" }
    );

    expect(seen).toEqual(["one-run", "one-run", "one-run"]);
  });
});
