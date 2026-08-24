import { describe, it, expect } from "vitest";
import { buildRecommenderGraph, profileScopeParamKeys } from "./graph";
import { NODE_REGISTRY } from "./nodes";
import { PARAMS, PARAM_KEYS } from "./params";
import { DEFAULT_PROMOTED_ALBUM } from "../../shared/settingsDefaults";

/**
 * The knobs `computeConfigHash` (server/db/userProfile.ts) currently folds into a stored
 * profile's provenance, minus `vocabularyVersion`, which is not a config field.
 *
 * Pinned here so the graph's own answer to "which knobs shape the profile" can be checked
 * against the hand-maintained list *before* phase 2 replaces the list with the graph. A
 * mismatch at that point would silently invalidate every stored profile on deploy.
 */
const CONFIG_HASH_KEYS = [
  "albumTagsPerArtist",
  "distributionWeight",
  "exploreCandidateCount",
  "genericTags",
  "listeningWeight",
  "maxTrackMinutesForWeight",
  "minAvailableTracksForDistribution",
  "minPlaysForDistribution",
  "momentumRecentBuckets",
  "playTrendWindowDays",
  "ratingWeight",
  "seriesBucketDays",
  "seriesSpanDays",
  "tagsPerArtist",
  "topArtistsCount",
];

describe("recommender graph registry", () => {
  it("owns every recommender setting exactly once", () => {
    const owned = NODE_REGISTRY.flatMap((node) => node.params ?? []);

    expect([...owned].sort()).toEqual([...PARAM_KEYS].sort());
    expect(new Set(owned).size).toBe(owned.length);
  });

  it("declares a param for every key the settings type carries", () => {
    expect([...PARAM_KEYS].sort()).toEqual(
      Object.keys(DEFAULT_PROMOTED_ALBUM).sort()
    );
  });

  it("keys each param definition by its own key", () => {
    for (const key of PARAM_KEYS) {
      expect(PARAMS[key].key).toBe(key);
    }
  });

  it("only references params that something owns", () => {
    const owned = new Set(NODE_REGISTRY.flatMap((node) => node.params ?? []));

    for (const node of NODE_REGISTRY) {
      for (const key of node.usesParams ?? []) {
        expect(owned.has(key)).toBe(true);
      }
    }
  });

  it("never both owns and merely uses the same param", () => {
    for (const node of NODE_REGISTRY) {
      const owned = new Set(node.params ?? []);
      for (const key of node.usesParams ?? []) {
        expect(owned.has(key)).toBe(false);
      }
    }
  });

  it("gives every node a unique id", () => {
    const ids = NODE_REGISTRY.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("connects every edge to nodes that exist", () => {
    const { nodes, edges } = buildRecommenderGraph();
    const ids = new Set(nodes.map((node) => node.id));

    for (const edge of edges) {
      expect(ids.has(edge.from)).toBe(true);
      expect(ids.has(edge.to)).toBe(true);
    }
  });

  it("leaves no node stranded except the capture sources", () => {
    const { nodes, edges } = buildRecommenderGraph();
    const connected = new Set(edges.flatMap((edge) => [edge.from, edge.to]));

    for (const node of nodes) {
      expect(connected.has(node.id)).toBe(true);
    }
  });

  it("orders fallback edges into one node without ties", () => {
    const { edges } = buildRecommenderGraph();
    const byTarget = new Map<string, number[]>();

    for (const edge of edges) {
      if (edge.kind !== "fallback") continue;
      expect(edge.order).toBeTypeOf("number");
      byTarget.set(edge.to, [...(byTarget.get(edge.to) ?? []), edge.order!]);
    }

    for (const orders of byTarget.values()) {
      expect(new Set(orders).size).toBe(orders.length);
    }
  });

  it("resolves the owner of every referenced param", () => {
    const { nodes } = buildRecommenderGraph();

    for (const node of nodes) {
      for (const used of node.usesParams) {
        expect(used.owner).not.toBe("");
        expect(nodes.some((n) => n.id === used.owner)).toBe(true);
      }
    }
  });

  it("explains its repeat, quota and fallback nodes", () => {
    const { nodes } = buildRecommenderGraph();
    const structural = nodes.filter((node) =>
      ["repeat", "quota", "fallback"].includes(node.kind)
    );

    expect(structural.length).toBeGreaterThan(0);
    for (const node of structural) {
      expect(node.note).toBeTruthy();
    }
  });

  it("matches the profile config hash to the profile-scope params", () => {
    expect(profileScopeParamKeys()).toEqual(CONFIG_HASH_KEYS);
  });

  it("names every formula placeholder after a param the node can reach", () => {
    const { nodes } = buildRecommenderGraph();

    for (const node of nodes) {
      const reachable = new Set([
        ...node.params.map((param) => param.key),
        ...node.usesParams.map((param) => param.key),
      ]);
      for (const param of node.params) {
        for (const match of param.formula?.matchAll(/\{(\w+)\}/g) ?? []) {
          expect(reachable.has(match[1] as never)).toBe(true);
        }
      }
    }
  });
});
