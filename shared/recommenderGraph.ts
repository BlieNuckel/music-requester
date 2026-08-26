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
 * as several pipelines. A node belongs to exactly one flow and appears in the others as a
 * boundary reference.
 *
 * The profile build was one flow to begin with, and at twenty nodes over fourteen lanes it
 * had the same problem in miniature: the total edge span came to seventy-five lanes whichever
 * way it was laid out, because seven producers scattered across the whole depth all wrote
 * into one document. That is a property of the shape, not of the layout, and no arrangement
 * fixes it. Split at the two points the pipeline genuinely narrows — everything becomes
 * windowed listening, that becomes one ranked artist set — and each chart is five lanes deep
 * with its neighbours showing as boundary stubs.
 */
export type FlowId =
  "ingestion" | "listening" | "ranking" | "profile" | "spotlight" | "artists";

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
    id: "listening",
    label: "Listening",
    summary:
      "How the log becomes measured listening over a recent window, rolled up by artist, by album and by track.",
  },
  {
    id: "ranking",
    label: "Artist ranking",
    summary:
      "How that listening becomes one ranked set of artists: discounted for a one-hit habit, boosted by ratings, carrying the shape of how it arrived.",
  },
  {
    id: "profile",
    label: "Taste profile",
    summary:
      "How the top artists become the stored document every recommender reads: what their records are tagged as, who sits next to them, and what you already play.",
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

/**
 * How far the code has got. `live` means the recommender executes this node today.
 * `ported` means its body is written against the graph's shapes and tested, but nothing
 * calls it yet — the old path is still what runs.
 *
 * The field exists so a half-migrated pipeline can be drawn honestly. Without it the graph
 * has to choose between showing the shape being built and describing what executes, and
 * either choice makes it lie for the length of the migration.
 */
export type NodeStatus = "live" | "ported";

/**
 * What shape a knob takes, which is also what control renders it. `ratio` is a share of one
 * and reads as a percentage; `split` is a share of one that divides a quantity between two
 * named things, so it reads from both ends at once; `factor` is a multiplier, which is
 * fractional but not a share of anything, so showing it as a percentage would misstate it.
 * `int` therefore means a whole number and nothing else.
 */
export type ParamKind =
  | "ratio"
  | "split"
  | "factor"
  | "int"
  | "days"
  | "minutes"
  | "enum"
  | "tags"
  | "boolean";

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
   * The two things a `split` knob divides one quantity between, the one at 0 first. Both are
   * named because the knob only means something as a pair: a fraction on its own leaves the
   * reader to work out what the other side of it was.
   */
  ends?: { low: string; high: string };
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

/**
 * A knob still carried by the settings — and still folded into a stored profile's config
 * hash — that no node in this graph reads. The pipeline running today may still read it,
 * since the node replacing its work can be `ported` rather than live; it is declared here
 * rather than parked on a graph node that does not read it.
 */
export type RetiredParam = ParamDef & { reason: string };

export type GraphNode = {
  id: string;
  title: string;
  scope: NodeScope;
  kind: NodeKind;
  /**
   * One sentence, at a glance. Anything longer belongs in the three fields below, which say
   * the same thing in a shape a reader can scan: prose describing a pipeline step reads as
   * wordy to everyone who does not already know the code it describes.
   */
  summary: string;
  /** What arrives, one line each. */
  takes: string[];
  /** What the step does to it, in order, one line each. */
  does: string[];
  /** What it hands on. */
  gives: string;
  flow: FlowId;
  /** Params this node owns, resolved from the shared definitions. */
  params: ParamDef[];
  /** Params owned elsewhere that also change what this node does. */
  usesParams: GraphNodeParam[];
  /** Whether this node spends the build's shared MusicBrainz resolution budget. */
  spendsBudget: boolean;
  status: NodeStatus;
  /** Repo-relative file holding this node's body, where one has been written. */
  module?: string;
  /**
   * The aside shown under the summary. Required on `repeat`, `fallback` and `quota` nodes,
   * where the iteration or the ordering *is* the meaning; optional on any other node.
   */
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
  retiredParams: RetiredParam[];
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
