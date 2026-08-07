import { MB_BASE, mbJson } from "./config";
import { mbCached, MB_TTL } from "./cache";
import type { MbPriority } from "./queue";
import type { MusicBrainzLabelWithRels } from "./types";

type LabelInfo = { name: string; mbid: string };

const MAX_ANCESTOR_DEPTH = 5;

function extractParents(data: MusicBrainzLabelWithRels): LabelInfo[] {
  return (
    data.relations
      ?.filter(
        (r) =>
          r.type === "label ownership" && r.direction === "backward" && !r.ended
      )
      .map((r) => ({ name: r.label.name, mbid: r.label.id })) ?? []
  );
}

function loadLabelWithRels(
  labelMbid: string,
  priority: MbPriority
): Promise<MusicBrainzLabelWithRels | null> {
  const url = `${MB_BASE}/label/${labelMbid}?inc=label-rels&fmt=json`;
  return mbJson<MusicBrainzLabelWithRels>(url, priority);
}

function fetchLabelWithRels(
  labelMbid: string,
  priority: MbPriority
): Promise<MusicBrainzLabelWithRels | null> {
  return mbCached(
    { key: `label-rels:${labelMbid}`, ttlSeconds: MB_TTL.immutable, priority },
    (p) => loadLabelWithRels(labelMbid, p)
  );
}

type AncestorWalkOptions = {
  onAncestorFound?: (label: LabelInfo) => void;
  /** Called after each BFS depth level; return true to stop walking further */
  shouldStop?: (ancestors: LabelInfo[]) => boolean;
};

/** BFS walk up ownership chains, returning all ancestors nearest-first */
export async function getLabelAncestors(
  labelMbid: string,
  options?: AncestorWalkOptions,
  priority: MbPriority = "interactive"
): Promise<LabelInfo[]> {
  const ancestors: LabelInfo[] = [];
  const visited = new Set<string>([labelMbid]);
  let queue = [labelMbid];

  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH && queue.length > 0; depth++) {
    const nextQueue: string[] = [];

    for (const mbid of queue) {
      const data = await fetchLabelWithRels(mbid, priority);
      if (!data) continue;

      for (const parent of extractParents(data)) {
        if (visited.has(parent.mbid)) continue;
        visited.add(parent.mbid);
        ancestors.push(parent);
        options?.onAncestorFound?.(parent);
        nextQueue.push(parent.mbid);
      }
    }

    if (options?.shouldStop?.(ancestors)) break;
    queue = nextQueue;
  }

  return ancestors;
}
