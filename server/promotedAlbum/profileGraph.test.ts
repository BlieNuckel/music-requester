import { describe, it, expect } from "vitest";
import { PROFILE_BODIES } from "./profileGraph";
import { NODE_REGISTRY } from "../recommenderGraph/nodes";

/** What `regenerateProfile` asks the runtime for. */
const TARGETS = [
  "genreVector",
  "artistTags",
  "albumTags",
  "similarGraph",
  "attachSeries",
  "artistSeries",
  "knownAlbums",
];

/** The node ids a run reaches from those targets, following data edges only. */
function reachable(from: string[], given: Set<string>): Set<string> {
  const byId = new Map(NODE_REGISTRY.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const queue = [...from];

  while (queue.length > 0) {
    const id = queue.pop()!;
    if (seen.has(id) || given.has(id)) continue;
    seen.add(id);
    for (const input of byId.get(id)?.inputs ?? []) {
      if (input.kind !== "control") queue.push(input.from);
    }
  }
  return seen;
}

describe("PROFILE_BODIES", () => {
  /**
   * The runtime resolves a node's dependencies from the registry, so a body missing anywhere
   * under the targets fails the whole build at run time rather than at compile time. This is
   * the check that keeps that a test failure instead of a broken profile.
   */
  it("wires a body for every node a profile build reaches", () => {
    const needed = reachable(TARGETS, new Set(["signalLog"]));

    expect(needed.size).toBeGreaterThan(1);
    expect([...needed].filter((id) => !PROFILE_BODIES.has(id))).toEqual([]);
  });

  it("wires nothing that a profile build does not reach", () => {
    const needed = reachable(TARGETS, new Set(["signalLog"]));

    expect([...PROFILE_BODIES.keys()].filter((id) => !needed.has(id))).toEqual(
      []
    );
  });

  /**
   * A body that fetches what its declared input already holds is the drift the graph exists
   * to stop: the picture says one read, the code does three.
   */
  it("reads the signal series once, through the node that loads it", async () => {
    const { readFileSync } = await import("node:fs");
    const body = readFileSync("server/promotedAlbum/profileGraph.ts", "utf8");

    expect(body).not.toMatch(
      /getSignalEvents|loadEpisodeSeries|loadArtistSeries/
    );
  });

  it("leaves the capture sweep out of a build, since it runs on its own clock", () => {
    expect(PROFILE_BODIES.has("plexCapture")).toBe(false);
    expect(PROFILE_BODIES.has("plexSessions")).toBe(false);
    expect(PROFILE_BODIES.has("signalLog")).toBe(false);
  });
});
