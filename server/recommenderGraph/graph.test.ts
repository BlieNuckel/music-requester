import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { buildRecommenderGraph, profileScopeParamKeys } from "./graph";
import { NODE_REGISTRY, RETIRED_PARAMS } from "./nodes";
import { PARAMS, PARAM_KEYS } from "./params";
import { DEFAULT_PROMOTED_ALBUM } from "../../shared/settingsDefaults";
import { FLOWS } from "../../shared/recommenderGraph";

/**
 * The knobs `computeConfigHash` (server/db/userProfile.ts) currently folds into a stored
 * profile's provenance, minus `vocabularyVersion`, which is not a config field.
 *
 * Pinned here so the graph's own answer to "which knobs shape the profile" can be checked
 * against the hand-maintained list *before* phase 2 replaces the list with the graph. A
 * mismatch at that point would silently invalidate every stored profile on deploy.
 *
 * Retired knobs count towards it: they are still in the settings and still in the hash, and
 * they leave both in the commit that puts their replacement live.
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
  it("accounts for every recommender setting exactly once", () => {
    const owned = NODE_REGISTRY.flatMap((node) => node.params ?? []);
    const retired = RETIRED_PARAMS.map((param) => param.key);

    expect([...owned, ...retired].sort()).toEqual([...PARAM_KEYS].sort());
    expect(new Set([...owned, ...retired]).size).toBe(
      owned.length + retired.length
    );
  });

  it("says why every retired knob is still in the settings", () => {
    for (const param of RETIRED_PARAMS) {
      expect(param.reason.length).toBeGreaterThan(0);
    }
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

  it("gives every edge a unique id, even two sharing a pair", () => {
    const { edges } = buildRecommenderGraph();
    const ids = edges.map((edge) => edge.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * The one edge from the build into a pick: the promoted-artists grid re-runs the weighting
   * instead of reading the stored profile, which is duplicate work rather than a data path.
   * It leaves this list when that is fixed; nothing else may join it.
   */
  it("reads the pick sources off the served profile, not off the build", () => {
    const { nodes, edges } = buildRecommenderGraph();
    const building = new Set(
      nodes
        .filter((node) => node.scope === "profile" && node.kind !== "store")
        .map((node) => node.id)
    );

    const leaking = edges.filter(
      (edge) =>
        building.has(edge.from) &&
        nodes.find((node) => node.id === edge.to)?.scope === "pick"
    );

    expect(leaking.map((edge) => edge.id)).toEqual([
      "attachSeries->promotedArtistSeeds",
    ]);
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

  it("puts every node in a declared flow, and leaves no flow empty", () => {
    const declared = new Set(FLOWS.map((flow) => flow.id));
    const used = new Set(NODE_REGISTRY.map((node) => node.flow));

    for (const flow of used) expect(declared.has(flow)).toBe(true);
    for (const flow of declared) expect(used.has(flow)).toBe(true);
  });

  it("keeps each flow small enough to read as one chart", () => {
    for (const flow of FLOWS) {
      const size = NODE_REGISTRY.filter((n) => n.flow === flow.id).length;
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThanOrEqual(25);
    }
  });

  it("connects every flow but the first to something upstream", () => {
    const flowOf = new Map(NODE_REGISTRY.map((node) => [node.id, node.flow]));
    const { edges } = buildRecommenderGraph();

    for (const flow of FLOWS.filter((entry) => entry.id !== "ingestion")) {
      const incoming = edges.filter(
        (edge) =>
          flowOf.get(edge.to) === flow.id && flowOf.get(edge.from) !== flow.id
      );
      expect(incoming.length).toBeGreaterThan(0);
    }
  });

  it("settles the listening window once, for every derivation measured over it", () => {
    const { edges } = buildRecommenderGraph();
    const readers = edges
      .filter((edge) => edge.from === "listeningWindow")
      .map((edge) => edge.to);

    expect([...readers].sort()).toEqual([
      "albumListening",
      "artistListening",
      "artistRatings",
    ]);
  });

  it("points every ported node at a file that exists", () => {
    const { nodes } = buildRecommenderGraph();
    const ported = nodes.filter((node) => node.status === "ported");

    expect(ported.length).toBeGreaterThan(0);
    for (const node of ported) {
      expect([node.id, node.module]).toEqual([node.id, expect.any(String)]);
      expect([
        node.id,
        existsSync(resolve(process.cwd(), node.module!)),
      ]).toEqual([node.id, true]);
    }
  });

  it("keeps a node that names no module out of the ported set", () => {
    const { nodes } = buildRecommenderGraph();

    for (const node of nodes) {
      if (node.module) continue;
      expect([node.id, node.status]).toEqual([node.id, "live"]);
    }
  });

  it("stores everything the profile scope derives", () => {
    const { edges } = buildRecommenderGraph();
    const feeds = new Map<string, string[]>();
    for (const edge of edges) {
      feeds.set(edge.from, [...(feeds.get(edge.from) ?? []), edge.to]);
    }

    const reaching = new Set(["profileDocument"]);
    for (let added = true; added;) {
      added = false;
      for (const [from, targets] of feeds) {
        if (reaching.has(from)) continue;
        if (!targets.some((target) => reaching.has(target))) continue;
        reaching.add(from);
        added = true;
      }
    }

    for (const node of NODE_REGISTRY) {
      if (node.scope !== "profile") continue;
      expect([node.id, reaching.has(node.id)]).toEqual([node.id, true]);
    }
  });

  it("matches the profile config hash to the profile-scope params", () => {
    const retired = RETIRED_PARAMS.map((param) => param.key);

    expect([...profileScopeParamKeys(), ...retired].sort()).toEqual(
      CONFIG_HASH_KEYS
    );
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
