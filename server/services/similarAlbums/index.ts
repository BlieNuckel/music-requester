import NodeCache from "node-cache";
import {
  getAlbumDetails,
  searchReleaseGroups,
} from "../../api/musicbrainz/releaseGroups";
import { withCache } from "../../cache";
import { getConfigValue } from "../../config";
import { createLogger } from "../../logger";
import { normalizeAlbumKey } from "../../utils/albumKey";
import { collectArtistCandidates } from "./artistLeg";
import { rankCandidates } from "./rank";
import { collectTagCandidates } from "./tagLeg";
import type { MergedCandidate, SeedAlbum, SimilarAlbum } from "./types";

/** Albums returned to the caller. */
const MAX_RESULTS = 12;

/**
 * MusicBrainz searches one request may spend resolving candidates Last.fm gave no MBID for.
 * Each costs a paced slot on the interactive lane, which preempts the pollers, so an
 * unbounded resolve would hold the queue for as long as the candidate list is.
 */
const MB_RESOLUTION_BUDGET = 5;

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const cache = new NodeCache();

const log = createLogger("similarAlbums");

async function loadSeed(mbid: string): Promise<SeedAlbum | null> {
  const details = await getAlbumDetails(mbid);
  if (!details) return null;

  return {
    mbid: details.mbid,
    title: details.title,
    artistName: details.artistName,
    artistMbid: details.artistMbid ?? "",
  };
}

/**
 * Find a candidate's release group by searching for it. Only a title+artist match on the
 * normalized key is accepted — a near-miss here would send the user to a different record
 * than the one the recommendation was about.
 */
async function resolveMbid(
  candidate: MergedCandidate
): Promise<{ mbid: string; year: string } | null> {
  const title = candidate.title.replace(/"/g, " ");
  const artist = candidate.artistName.replace(/"/g, " ");
  const query = `releasegroup:"${title}" AND artist:"${artist}"`;

  try {
    const result = await searchReleaseGroups(query);
    const match = result["release-groups"].find(
      (rg) =>
        normalizeAlbumKey(
          rg["artist-credit"]?.[0]?.artist?.name ?? "",
          rg.title
        ) === candidate.key
    );
    if (!match) return null;

    return {
      mbid: match.id,
      year: (match["first-release-date"] || "").slice(0, 4),
    };
  } catch (err) {
    log.warn(`release-group search failed for ${candidate.key}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function toSimilarAlbum(
  candidate: MergedCandidate,
  year: string
): SimilarAlbum {
  return {
    mbid: candidate.mbid,
    title: candidate.title,
    artistName: candidate.artistName,
    artistMbid: candidate.artistMbid,
    year,
    score: candidate.score,
    reasons: candidate.reasons,
  };
}

/**
 * Walk the ranked list until enough albums have a release-group MBID. Candidates without
 * one can't be rendered at all — the album route and the cover art are both keyed by it —
 * so they are resolved while the budget lasts and dropped after it runs out.
 */
async function takeResolved(
  ranked: MergedCandidate[]
): Promise<SimilarAlbum[]> {
  const albums: SimilarAlbum[] = [];
  let budget = MB_RESOLUTION_BUDGET;

  for (const candidate of ranked) {
    if (albums.length >= MAX_RESULTS) break;

    if (candidate.mbid) {
      albums.push(toSimilarAlbum(candidate, ""));
      continue;
    }
    if (budget <= 0) continue;

    budget -= 1;
    const resolved = await resolveMbid(candidate);
    if (!resolved) continue;

    candidate.mbid = resolved.mbid;
    albums.push(toSimilarAlbum(candidate, resolved.year));
  }

  return albums;
}

async function buildSimilarAlbums(mbid: string): Promise<SimilarAlbum[]> {
  const seed = await loadSeed(mbid);
  if (!seed || !seed.artistName || !seed.title) return [];

  const genericTags = new Set(
    getConfigValue("promotedAlbum").genericTags.map((t) => t.toLowerCase())
  );

  const [tagCandidates, artistCandidates] = await Promise.all([
    collectTagCandidates(seed, genericTags),
    collectArtistCandidates(seed),
  ]);

  const ranked = rankCandidates([...tagCandidates, ...artistCandidates], seed);
  return takeResolved(ranked);
}

/**
 * Albums similar to a release group, synthesized from a genre-tag leg and a similar-artist
 * leg. Deliberately impersonal — nothing here depends on who is asking — which is what lets
 * one cache entry serve every user, and keeps the album page describing the album rather
 * than the viewer. In-library state is applied by the client, which already holds it.
 */
export const getSimilarAlbums = withCache(buildSimilarAlbums, {
  cache,
  key: (mbid: string) => `similar-albums:${mbid}`,
  ttlMs: CACHE_TTL_MS,
  label: "similarAlbums",
});
