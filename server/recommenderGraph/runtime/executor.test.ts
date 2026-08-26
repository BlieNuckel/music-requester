import { describe, it, expect, vi } from "vitest";
import { fallbackOrder, runGraph } from "./executor";
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
      produced: true,
      facts: [],
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
  /**
   * The whole point of a fallback edge is that it is tried only when the one before it
   * produced nothing. Settling all three before the body starts would spend the paced
   * lookups the ordering exists to avoid.
   */
  it("leaves a fallback input alone until a body asks for it", async () => {
    const explore = vi.fn(() => "explore album");
    const personal = vi.fn(() => "personal album");

    const { outputs } = await runGraph(
      ["sourceChain"],
      bodies({
        exploreAlbum: explore,
        personalCandidates: () => [],
        personalBand: () => [],
        personalPreference: () => [],
        personalAlbum: personal,
        candidateWalk: () => "tag album",
        sourceChain: (inputs, _ctx, runtime) => {
          expect(inputs).toEqual({});
          return runtime.resolve("personalAlbum");
        },
      }),
      { label: "t" },
      new Map([["profileFreshness", "profile"]])
    );

    expect(outputs.get("sourceChain")).toBe("personal album");
    expect(explore).not.toHaveBeenCalled();
    expect(personal).toHaveBeenCalledTimes(1);
  });

  it("declares the order a fallback node tries its inputs in", () => {
    expect(fallbackOrder("sourceChain")).toEqual([
      "exploreAlbum",
      "personalAlbum",
      "candidateWalk",
    ]);
  });

  it("refuses to order the fallbacks of a node nobody declared", () => {
    expect(() => fallbackOrder("nonesuch")).toThrow(/No node registered/);
  });

  /**
   * A repeat node's input is the thing it runs many times, so running it once up front is
   * the iteration the node exists to own.
   */
  it("leaves a repeat node to run its own input, once per turn", async () => {
    const attempt = vi.fn(() => "one pick");

    const { outputs } = await runGraph(
      ["pickLoop"],
      bodies({
        exploreQuota: () => 0,
        sourceChain: attempt,
        pickLoop: async (inputs, _ctx, runtime) => {
          expect(inputs).toEqual({});
          return [
            await runtime.resolve("sourceChain"),
            await runtime.resolve("sourceChain"),
            await runtime.resolve("sourceChain"),
          ];
        },
      }),
      { label: "t" }
    );

    expect(registered("pickLoop").kind).toBe("repeat");
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(outputs.get("pickLoop")).toHaveLength(3);
  });

  /**
   * A `pick`-scope node is never cached, so without this a caller asking for one would run
   * the whole flow and be handed nothing back.
   */
  it("hands back a target it refuses to cache", async () => {
    const { outputs } = await runGraph(
      ["tagDraw"],
      bodies({
        artistSample: () => ["one artist"],
        pickVector: () => "vector",
        tagDraw: () => "shoegaze",
      }),
      { label: "t" },
      new Map([["profileFreshness", "profile"]])
    );

    expect(registered("tagDraw").scope).toBe("pick");
    expect(outputs.get("tagDraw")).toBe("shoegaze");
  });
  it("asks a node to explain the turn it just took", async () => {
    const { trace } = await runGraph(
      ["signalLog"],
      bodies({
        plexCapture: () => "sweep",
        plexSessions: () => "sessions",
        signalLog: () => [1, 2, 3],
      }),
      { label: "t" },
      new Map(),
      new Map([
        [
          "signalLog",
          (_inputs, output) => [
            { label: "Rows", value: `${(output as number[]).length}` },
          ],
        ],
      ])
    );

    expect(trace[trace.length - 1].facts).toEqual([
      { label: "Rows", value: "3" },
    ]);
  });

  /**
   * A trace explains a recommendation that has already been made. An explainer that throws
   * has to cost its own line of the story and nothing else.
   */
  it("keeps the output when the explanation of it throws", async () => {
    const { outputs, trace } = await runGraph(
      ["signalLog"],
      bodies({
        plexCapture: () => "sweep",
        plexSessions: () => "sessions",
        signalLog: () => "raw",
      }),
      { label: "t" },
      new Map(),
      new Map([
        [
          "signalLog",
          () => {
            throw new Error("no idea");
          },
        ],
      ])
    );

    expect(outputs.get("signalLog")).toBe("raw");
    expect(trace[trace.length - 1].facts).toEqual([]);
  });

  it("says whether a node handed anything on", async () => {
    const { trace } = await runGraph(
      ["plexCapture", "plexSessions", "signalLog"],
      bodies({
        plexCapture: () => null,
        plexSessions: () => [],
        signalLog: () => "raw",
      }),
      { label: "t" }
    );

    expect(trace.map((run) => [run.nodeId, run.produced])).toEqual([
      ["plexCapture", false],
      ["plexSessions", false],
      ["signalLog", true],
    ]);
  });

  it("hands a repeat node the turns each of its own runs took", async () => {
    let attempt = 0;
    const { outputs } = await runGraph(
      ["pickLoop"],
      bodies({
        exploreQuota: () => 0,
        sourceChain: () => (attempt += 1),
        pickLoop: async (_inputs, _ctx, runtime) => [
          (await runtime.traced("sourceChain")).trace.map((r) => r.nodeId),
          (await runtime.traced("sourceChain")).trace.map((r) => r.nodeId),
        ],
      }),
      { label: "t" }
    );

    expect(outputs.get("pickLoop")).toEqual([["sourceChain"], ["sourceChain"]]);
  });
});
