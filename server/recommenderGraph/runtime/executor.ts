import { NODE_REGISTRY } from "../nodes";
import type { NodeRegistration } from "../nodes";

/** What a node body receives: its inputs by the id of the node that produced them. */
export type NodeInputs = Readonly<Record<string, unknown>>;

export type NodeBody<Ctx> = (
  inputs: NodeInputs,
  ctx: Ctx
) => unknown | Promise<unknown>;

/** One node's turn, for the trace a later phase renders. */
export type NodeRun = {
  nodeId: string;
  ms: number;
  /** A short shape-of-the-output line; never the output itself. */
  summary: string;
};

export type GraphRun = {
  outputs: ReadonlyMap<string, unknown>;
  trace: NodeRun[];
};

const REGISTRY = new Map<string, NodeRegistration>(
  NODE_REGISTRY.map((node) => [node.id, node])
);

/**
 * Enough about an output to read a trace without holding the run in memory twice. A profile's
 * album tags are tens of thousands of entries; the trace wants to say "1,842 of them".
 */
function summarize(value: unknown): string {
  if (value === null || value === undefined) return "nothing";
  if (Array.isArray(value)) return `${value.length} items`;
  if (value instanceof Map) return `${value.size} keys`;
  if (value instanceof Set) return `${value.size} entries`;
  if (typeof value === "object") return `{${Object.keys(value).join(", ")}}`;
  return String(value);
}

/**
 * A node runs once per execution and its result is reused, so a step feeding three others
 * folds the log once rather than three times — the duplication a hand-wired sequence has to
 * remember not to introduce.
 *
 * `pick`-scope nodes are deliberately never cached. A weighted draw is re-rolled per
 * recommendation on purpose, and freezing one draw into a shared result is exactly the bug
 * that makes a whole carousel come from one corner of someone's taste.
 */
function cacheable(node: NodeRegistration): boolean {
  return node.scope !== "pick";
}

async function runNode<Ctx>(
  nodeId: string,
  bodies: ReadonlyMap<string, NodeBody<Ctx>>,
  ctx: Ctx,
  done: Map<string, unknown>,
  trace: NodeRun[],
  running: Set<string>
): Promise<unknown> {
  const node = REGISTRY.get(nodeId);
  if (!node) throw new Error(`No node registered as "${nodeId}"`);
  if (done.has(nodeId)) return done.get(nodeId);
  if (running.has(nodeId)) {
    throw new Error(`Cycle in the graph, reached "${nodeId}" twice`);
  }

  const body = bodies.get(nodeId);
  if (!body) throw new Error(`No body wired for node "${nodeId}"`);

  running.add(nodeId);
  const inputs: Record<string, unknown> = {};
  for (const input of node.inputs) {
    if (input.kind === "control") continue;
    inputs[input.from] = await runNode(
      input.from,
      bodies,
      ctx,
      done,
      trace,
      running
    );
  }
  running.delete(nodeId);

  const startedAt = Date.now();
  const output = await body(inputs, ctx);
  trace.push({
    nodeId,
    ms: Date.now() - startedAt,
    summary: summarize(output),
  });

  if (cacheable(node)) done.set(nodeId, output);
  return output;
}

/**
 * Run whatever the named nodes need, and nothing else.
 *
 * The wiring is the registry's, not the caller's: asking for a node pulls in exactly the
 * steps it depends on, which is what stops a hand-written sequence and a drawn graph from
 * describing two different pipelines.
 *
 * `control` inputs are scheduling rather than data — something triggers something else — so
 * they are not resolved here. A node whose only inputs are control edges is a root.
 *
 * `given` names the nodes this run starts from rather than computes. A profile build reads
 * the signal log; it does not sweep Plex to fill it, because that runs on its own schedule.
 * Seeding the boundary keeps that edge in the drawing — the log really is where the data
 * comes from — without the run reaching back through it.
 */
export async function runGraph<Ctx>(
  targets: string[],
  bodies: ReadonlyMap<string, NodeBody<Ctx>>,
  ctx: Ctx,
  given: ReadonlyMap<string, unknown> = new Map()
): Promise<GraphRun> {
  const done = new Map<string, unknown>(given);
  const trace: NodeRun[] = [];

  for (const target of targets) {
    await runNode(target, bodies, ctx, done, trace, new Set());
  }
  return { outputs: done, trace };
}
