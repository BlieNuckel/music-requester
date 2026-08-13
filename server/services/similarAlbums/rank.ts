import { normalizeAlbumKey } from "../../utils/albumKey";
import { isPlaceholderArtist } from "../../utils/artistFilter";
import type { AlbumCandidate, MergedCandidate, SeedAlbum } from "./types";

const TAG_WEIGHT = 0.5;
const ARTIST_WEIGHT = 0.5;

/**
 * Applied when both legs proposed the same album. Album similarity is synthesized rather
 * than measured, so two independent recipes agreeing is the only corroboration available —
 * worth more than either leg scoring it highly on its own.
 */
const BOTH_LEGS_BOOST = 1.25;

function sameArtist(candidate: AlbumCandidate, seed: SeedAlbum): boolean {
  if (candidate.artistMbid && seed.artistMbid) {
    return candidate.artistMbid === seed.artistMbid;
  }
  return (
    normalizeAlbumKey(candidate.artistName, "") ===
    normalizeAlbumKey(seed.artistName, "")
  );
}

function isEligible(candidate: AlbumCandidate, seed: SeedAlbum): boolean {
  if (!candidate.title || !candidate.artistName) return false;
  if (isPlaceholderArtist(candidate.artistName, candidate.artistMbid)) {
    return false;
  }
  if (candidate.mbid && candidate.mbid === seed.mbid) return false;
  if (sameArtist(candidate, seed)) return false;
  return true;
}

function mergeInto(existing: MergedCandidate, candidate: AlbumCandidate): void {
  if (candidate.reason === "tag") {
    existing.tagScore = Math.max(existing.tagScore, candidate.score);
  } else {
    existing.artistScore = Math.max(existing.artistScore, candidate.score);
  }
  if (!existing.reasons.includes(candidate.reason)) {
    existing.reasons.push(candidate.reason);
  }
  if (!existing.mbid && candidate.mbid) existing.mbid = candidate.mbid;
  if (!existing.artistMbid && candidate.artistMbid) {
    existing.artistMbid = candidate.artistMbid;
  }
}

function toMerged(candidate: AlbumCandidate, key: string): MergedCandidate {
  return {
    key,
    title: candidate.title,
    artistName: candidate.artistName,
    artistMbid: candidate.artistMbid,
    mbid: candidate.mbid,
    tagScore: candidate.reason === "tag" ? candidate.score : 0,
    artistScore: candidate.reason === "artist" ? candidate.score : 0,
    score: 0,
    reasons: [candidate.reason],
  };
}

function finalScore(merged: MergedCandidate): number {
  const base =
    TAG_WEIGHT * merged.tagScore + ARTIST_WEIGHT * merged.artistScore;
  return merged.reasons.length > 1 ? base * BOTH_LEGS_BOOST : base;
}

/**
 * Merge both legs into one ranked list. Candidates are keyed on normalized artist+title
 * rather than MBID because Last.fm supplies an MBID only sometimes — keying on it would
 * file the same album twice whenever one leg happened to carry one and the other didn't.
 */
export function rankCandidates(
  candidates: AlbumCandidate[],
  seed: SeedAlbum
): MergedCandidate[] {
  const merged = new Map<string, MergedCandidate>();

  for (const candidate of candidates) {
    if (!isEligible(candidate, seed)) continue;

    const key = normalizeAlbumKey(candidate.artistName, candidate.title);
    if (key === normalizeAlbumKey(seed.artistName, seed.title)) continue;

    const existing = merged.get(key);
    if (existing) {
      mergeInto(existing, candidate);
    } else {
      merged.set(key, toMerged(candidate, key));
    }
  }

  const ranked = [...merged.values()];
  for (const entry of ranked) entry.score = finalScore(entry);

  return ranked.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}
