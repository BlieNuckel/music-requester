/**
 * The recommender drawn as nodes and edges: one declared description of the pipeline that
 * both the settings UI and (from phase 2 onwards) the code that runs it read from.
 *
 * Types only. The registry itself lives server-side in `server/recommenderGraph/`, and the
 * frontend receives it over `/api/recommendations/graph` rather than importing it, so a
 * node gaining a runtime body later cannot drag server code into the bundle.
 */

import type { PromotedAlbumSettings } from "./settingsDefaults";

/**
 * Which stage of the pipeline a node belongs to. `profile` is load-bearing beyond layout:
 * those are the nodes whose params shape the persisted taste profile, and therefore the
 * ones that belong in the profile's config hash.
 */
export type NodeScope = "ingest" | "profile" | "pick" | "serve";

/**
 * Which chart a node belongs to. One canvas holding every node was drawn first and was
 * unreadable: the flows share nodes but not shape, so they read as one tangle rather than
 * as four pipelines. A node belongs to exactly one flow and appears in the others as a
 * boundary reference.
 */
export type FlowId = "ingestion" | "profile" | "spotlight" | "artists";

export type FlowDef = {
  id: FlowId;
  label: string;
  /** One sentence on what this flow produces, shown above its canvas. */
  summary: string;
};

export const FLOWS: FlowDef[] = [
  {
    id: "ingestion",
    label: "Plex ingestion",
    summary:
      "What we read from Plex and how it lands in the append-only signal log. Everything else reads the log, never Plex.",
  },
  {
    id: "profile",
    label: "Taste profile",
    summary:
      "How the log becomes one weighted picture of your taste: what you listen to, how broadly, what it is tagged as, and who sits next to it.",
  },
  {
    id: "spotlight",
    label: "Spotlight carousel",
    summary:
      "How one set of album recommendations is picked, across three sources tried in order until one answers.",
  },
  {
    id: "artists",
    label: "Promoted artists",
    summary:
      "How the artist grid is picked, off the same weighted artist set the profile ranks.",
  },
];

/**
 * What a node *is*, which decides how it draws. `repeat`, `fallback` and `quota` exist
 * because the pick flow is not a DAG: drawn as plain steps they would imply that everything
 * runs once, in parallel, which is the opposite of what the code does.
 */
export type NodeKind =
  "source" | "step" | "store" | "repeat" | "fallback" | "quota" | "output";

/**
 * `data` is "this output feeds that input". `fallback` is "only if the previous one produced
 * nothing", and carries an order. `control` is scheduling: something triggers something else
 * rather than feeding it.
 */
export type EdgeKind = "data" | "fallback" | "control";

export type ParamKind =
  "ratio" | "int" | "days" | "minutes" | "enum" | "tags" | "boolean";

export type ParamOption = { value: string; label: string };

export type ParamDef = {
  key: keyof PromotedAlbumSettings;
  kind: ParamKind;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  /** Upper bound taken from another param's current value, e.g. picked <= top artists. */
  maxFrom?: keyof PromotedAlbumSettings;
  options?: ParamOption[];
  /**
   * The sentence the node reads as, with `{key}` placeholders rendered as live inputs:
   * `"weight x (1 + {ratingWeight} x stars/10)"`. Absent when the knob is not part of a
   * formula, in which case it renders as a plain labelled field.
   */
  formula?: string;
  /** The longer explanation, shown on demand rather than filling the node. */
  description: string;
};

export type GraphNodeParam = ParamDef & { owner: string };

export type GraphNode = {
  id: string;
  title: string;
  scope: NodeScope;
  kind: NodeKind;
  /** One or two sentences. The paragraph belongs on the params, not here. */
  summary: string;
  flow: FlowId;
  /** Params this node owns, resolved from the shared definitions. */
  params: ParamDef[];
  /** Params owned elsewhere that also change what this node does. */
  usesParams: GraphNodeParam[];
  /** Whether this node spends the build's shared MusicBrainz resolution budget. */
  spendsBudget: boolean;
  /** For `repeat` and `fallback` nodes: what the iteration or the ordering means. */
  note?: string;
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
  /** Priority among the fallback edges into one node, lowest first. */
  order?: number;
};

export type RecommenderGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /**
   * Shared resources that are spent rather than passed. Drawing these as edges would say
   * the sources hand them to each other, when in fact they compete for one allowance.
   */
  budgets: { id: string; label: string; amount: number; description: string }[];
};

export const NODE_SCOPE_LABELS: Record<NodeScope, string> = {
  ingest: "Capture",
  profile: "Taste profile",
  pick: "Recommendation",
  serve: "Serving",
};

/**
 * What changing a param costs, which is the question the settings page has to answer before
 * anyone touches a number. Derived from scope rather than listed per knob.
 */
export const SCOPE_EFFECT: Record<NodeScope, string> = {
  ingest: "Applies to the next capture sweep.",
  profile:
    "Rebuilds every stored taste profile, which is slow and rate-limited.",
  pick: "Applies to the next recommendation refresh.",
  serve: "Applies immediately.",
};
