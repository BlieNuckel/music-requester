import { NODE_REGISTRY, RETIRED_PARAMS } from "./nodes";
import { PARAMS } from "./params";
import type { ParamKey } from "./params";
import type { NodeRegistration } from "./nodes";
import type {
  GraphEdge,
  GraphNode,
  GraphNodeParam,
  RecommenderGraph,
} from "../../shared/recommenderGraph";

/**
 * Paced MusicBrainz lookups one carousel build may spend across all of its picks. Declared
 * here as a resource rather than as an edge: the three sources compete for one allowance,
 * and drawing that as a connection would say they hand it to each other.
 */
const RESOLUTION_BUDGET = 30;

const BUDGETS: RecommenderGraph["budgets"] = [
  {
    id: "resolutionBudget",
    label: "MusicBrainz lookups per build",
    amount: RESOLUTION_BUDGET,
    description:
      "MusicBrainz answers about one request per second, so a build cannot resolve candidates indefinitely. Every source spends from this one allowance, and a source that drains it leaves the ones after it nothing, which is an empty carousel rather than a worse one.",
  },
];

let cached: RecommenderGraph | null = null;

/** Which node owns each knob, so a node can show the knobs it merely reads. */
function buildOwnerIndex(): Map<ParamKey, string> {
  const owners = new Map<ParamKey, string>();
  for (const node of NODE_REGISTRY) {
    for (const key of node.params ?? []) owners.set(key, node.id);
  }
  return owners;
}

function toUsedParams(
  node: NodeRegistration,
  owners: Map<ParamKey, string>
): GraphNodeParam[] {
  return (node.usesParams ?? []).map((key) => ({
    ...PARAMS[key],
    owner: owners.get(key) ?? "",
  }));
}

function toNode(
  node: NodeRegistration,
  owners: Map<ParamKey, string>
): GraphNode {
  return {
    id: node.id,
    title: node.title,
    scope: node.scope,
    kind: node.kind,
    summary: node.summary,
    flow: node.flow,
    params: (node.params ?? []).map((key) => PARAMS[key]),
    usesParams: toUsedParams(node, owners),
    spendsBudget: node.spendsBudget ?? false,
    status: node.status ?? "live",
    ...(node.module ? { module: node.module } : {}),
    ...(node.note ? { note: node.note } : {}),
  };
}

/**
 * One node's incoming edges. Two can share a pair — a node reading one field of the stored
 * profile and falling back to another reads the same source twice — so the id carries an
 * occurrence suffix. The canvas keys edges by id and silently drops a duplicate.
 */
function toEdges(node: NodeRegistration): GraphEdge[] {
  const seen = new Map<string, number>();

  return node.inputs.map((input) => {
    const pair = `${input.from}->${node.id}`;
    const occurrence = seen.get(pair) ?? 0;
    seen.set(pair, occurrence + 1);

    return {
      id: occurrence === 0 ? pair : `${pair}#${occurrence}`,
      from: input.from,
      to: node.id,
      kind: input.kind,
      ...(input.label ? { label: input.label } : {}),
      ...(input.order !== undefined ? { order: input.order } : {}),
    };
  });
}

/**
 * The declared recommender graph. Structure only: current values come from the settings the
 * page already holds, so a knob has one source of truth rather than one on each side.
 */
export function buildRecommenderGraph(): RecommenderGraph {
  if (cached) return cached;

  const owners = buildOwnerIndex();
  cached = {
    nodes: NODE_REGISTRY.map((node) => toNode(node, owners)),
    edges: NODE_REGISTRY.flatMap(toEdges),
    retiredParams: RETIRED_PARAMS,
    budgets: BUDGETS,
  };
  return cached;
}

/**
 * Knobs owned by a node that shapes the persisted profile. These are exactly the ones a
 * stored profile's config hash has to cover: change one and every stored profile is
 * describing a taste that was derived differently.
 */
export function profileScopeParamKeys(): ParamKey[] {
  return NODE_REGISTRY.filter((node) => node.scope === "profile")
    .flatMap((node) => node.params ?? [])
    .sort();
}
