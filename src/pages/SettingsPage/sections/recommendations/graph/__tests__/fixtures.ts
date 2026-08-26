import type {
  GraphEdge,
  GraphNode,
  GraphNodeParam,
  ParamDef,
  RecommenderGraph,
} from "@shared/recommenderGraph";

export const ratingWeightParam: ParamDef = {
  key: "ratingWeight",
  kind: "int",
  label: "Rating weight",
  min: 0,
  max: 3,
  step: 0.1,
  formula: "weight x (1 + {ratingWeight} x stars/10)",
  description: "How much your Plex star ratings boost an artist's weight.",
};

export const listeningWeightParam: GraphNodeParam = {
  key: "listeningWeight",
  kind: "ratio",
  label: "Listening time vs plays",
  min: 0,
  max: 1,
  step: 0.05,
  description: "What counts as listening to an artist more.",
  owner: "playWeights",
};

export function makeNode(partial: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "ratingMultiplier",
    title: "Rating boost",
    scope: "profile",
    kind: "step",
    summary: "Scales each artist's weight by how highly you rate them.",
    takes: ["Each artist's weight", "Their rating"],
    does: ["Multiplies the weight by the rating"],
    gives: "The weight the recommender ranks by",
    flow: "profile",
    params: [ratingWeightParam],
    usesParams: [],
    spendsBudget: false,
    status: "live",
    ...partial,
  };
}

export function makeGraph(
  nodes: GraphNode[],
  edges: GraphEdge[] = [],
  retiredParams: RecommenderGraph["retiredParams"] = []
): RecommenderGraph {
  return {
    nodes,
    edges,
    retiredParams,
    budgets: [
      {
        id: "resolutionBudget",
        label: "MusicBrainz lookups per build",
        amount: 30,
        description: "Shared by every source.",
      },
    ],
  };
}
