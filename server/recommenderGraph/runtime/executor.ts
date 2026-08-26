import { NODE_REGISTRY } from "../nodes";
import type { NodeInput, NodeRegistration } from "../nodes";

/** What a node body receives: its inputs by the id of the node that produced them. */
export type NodeInputs = Readonly<Record<string, unknown>>;

/**
 * Runs one node on demand. Handed to every body, and the only way a node that decides for
 * itself *when* — or whether, or how many times — to run something can say so in code.
 */
export type Resolve = (nodeId: string) => Promise<unknown>;

export type NodeBody<Ctx> = (
  inputs: NodeInputs,
  ctx: Ctx,
  resolve: Resolve
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

type RunState<Ctx> = {
  bodies: ReadonlyMap<string, NodeBody<Ctx>>;
  ctx: Ctx;
  done: Map<string, unknown>;
  trace: NodeRun[];
};

const REGISTRY = new Map<string, NodeRegistration>(
  NODE_REGISTRY.map((node) => [node.id, node])
);

/**
 * The nodes a fallback node tries, in the order the registry declares. Read rather than
 * hard-coded so the order is one fact: reordering the sources on the canvas reorders which
 * one gets first refusal, instead of the drawing and the chain drifting apart.
 */
export function fallbackOrder(nodeId: string): string[] {
  const node = REGISTRY.get(nodeId);
  if (!node) throw new Error(`No node registered as "${nodeId}"`);
  return node.inputs
    .filter((input) => input.kind === "fallback")
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((input) => input.from);
}

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

/**
 * The inputs the runtime settles before the body starts.
 *
 * A `fallback` edge is by definition not one of them — it exists to be tried only if the one
 * before it produced nothing, and resolving it up front spends the lookups it was declared to
 * avoid. A `repeat` node settles nothing for the same reason one step further out: its input
 * is the thing it runs many times, and running it once first is exactly the iteration the
 * node exists to own.
 *
 * The other two structural kinds are not exceptions. A `quota` rations a settled input and a
 * `fallback` orders inputs it declares as such, so both are served by the ordinary rule.
 */
function eagerInputs(node: NodeRegistration): NodeInput[] {
  if (node.kind === "repeat") return [];
  return node.inputs.filter((input) => input.kind === "data");
}

async function runNode<Ctx>(
  nodeId: string,
  state: RunState<Ctx>,
  running: Set<string>
): Promise<unknown> {
  const node = REGISTRY.get(nodeId);
  if (!node) throw new Error(`No node registered as "${nodeId}"`);
  if (state.done.has(nodeId)) return state.done.get(nodeId);
  if (running.has(nodeId)) {
    throw new Error(`Cycle in the graph, reached "${nodeId}" twice`);
  }

  const body = state.bodies.get(nodeId);
  if (!body) throw new Error(`No body wired for node "${nodeId}"`);

  running.add(nodeId);
  const inputs: Record<string, unknown> = {};
  for (const input of eagerInputs(node)) {
    inputs[input.from] = await runNode(input.from, state, running);
  }
  running.delete(nodeId);

  const startedAt = Date.now();
  const output = await body(inputs, state.ctx, (id) =>
    runNode(id, state, new Set())
  );
  state.trace.push({
    nodeId,
    ms: Date.now() - startedAt,
    summary: summarize(output),
  });

  if (cacheable(node)) state.done.set(nodeId, output);
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
  const state: RunState<Ctx> = {
    bodies,
    ctx,
    done: new Map<string, unknown>(given),
    trace: [],
  };

  // Kept apart from `done` and merged over it at the end: a target is what the caller asked
  // for, and a `pick`-scope target — never cached, so that a draw is re-rolled per
  // recommendation — would otherwise run and hand nothing back.
  const asked = new Map<string, unknown>();
  for (const target of targets) {
    asked.set(target, await runNode(target, state, new Set()));
  }
  return { outputs: new Map([...state.done, ...asked]), trace: state.trace };
}
