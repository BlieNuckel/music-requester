import type {
  GraphEdge,
  GraphNode,
  GraphNodeParam,
  ParamDef,
  RecommenderGraph,
} from "@shared/recommenderGraph";

export const ratingWeightParam: ParamDef = {
  key: "ratingWeight",
  kind: "factor",
  label: "Rating weight",
  min: 0,
  max: 3,
  step: 0.1,
  effect: "weight x (1 + {ratingWeight} x stars/10)",
  description: "How much your Plex star ratings boost an artist's weight.",
};

export const listeningWeightParam: GraphNodeParam = {
  key: "listeningWeight",
  kind: "split",
  label: "Listening time vs plays",
  min: 0,
  max: 1,
  step: 0.05,
  ends: { low: "plays", high: "listening time" },
  description: "What counts as listening to an artist more.",
  owner: "artistListening",
  ownerTitle: "Listening per artist",
  ownerFlow: "listening",
  ownerScope: "profile",
};

export const topArtistsParam: GraphNodeParam = {
  key: "topArtistsCount",
  kind: "int",
  label: "Top artists",
  min: 1,
  max: 50,
  step: 1,
  effect: "keep the top {topArtistsCount} artists",
  description: "How many of your most-played artists the profile covers.",
  owner: "topArtists",
  ownerTitle: "Top artists",
  ownerFlow: "ranking",
  ownerScope: "profile",
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
