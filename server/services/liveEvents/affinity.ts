import { parseDerivedProfile } from "../../db/userProfile";
import { getUserProfile } from "../../db/userProfile";
import { parseGenres } from "../../db/liveEvents";
import type { HydratedLiveEvent } from "../../db/liveEvents";

export type GenreWeights = Map<string, number>;

export type ScoredEvent = {
  event: HydratedLiveEvent;
  affinity: number;
  matchedGenres: string[];
};

/**
 * JamBase uses slugs (`indie-rock`), the taste profile uses Last.fm-style tags
 * (`indie rock`). Comparing them needs one shape.
 */
export function normalizeGenre(genre: string): string {
  return genre.toLowerCase().replace(/[-_]+/g, " ").trim();
}

/**
 * The user's genre vector as weights in 0..1, relative to their strongest tag.
 * Relative rather than absolute so the affinity floor means the same thing for
 * a heavy listener and a light one.
 */
export function buildGenreWeights(
  genreVector: readonly { tag: string; weight: number }[]
): GenreWeights {
  const weights: GenreWeights = new Map();
  const max = Math.max(0, ...genreVector.map((entry) => entry.weight));
  if (max === 0) return weights;

  for (const entry of genreVector) {
    const tag = normalizeGenre(entry.tag);
    weights.set(tag, Math.max(weights.get(tag) ?? 0, entry.weight / max));
  }
  return weights;
}

/**
 * How much an event's lineup looks like the user's taste, in 0..1. The best
 * matching genre wins rather than the sum: a band tagged with ten genres should
 * not outrank a perfect match just for being verbosely tagged.
 */
export function scoreEventAffinity(
  event: HydratedLiveEvent,
  weights: GenreWeights
): { affinity: number; matchedGenres: string[] } {
  if (weights.size === 0) return { affinity: 0, matchedGenres: [] };

  let best = 0;
  const matched = new Set<string>();

  for (const performer of event.performers) {
    for (const genre of parseGenres(performer.genres)) {
      const weight = weights.get(normalizeGenre(genre));
      if (weight === undefined) continue;
      matched.add(genre);
      if (weight > best) best = weight;
    }
  }

  return { affinity: best, matchedGenres: [...matched] };
}

export async function loadGenreWeights(userId: number): Promise<GenreWeights> {
  const stored = await getUserProfile(userId);
  if (!stored) return new Map();
  return buildGenreWeights(
    parseDerivedProfile(stored.profile_json).genreVector
  );
}

/**
 * Rank by taste, then apply a floor and let the result be empty.
 *
 * Ranking alone would still fill every slot each day with the least-bad
 * options, and a shelf that is always full teaches people to stop looking at
 * it. Being empty most weeks is the intended behaviour.
 */
export function rankByAffinity(
  events: readonly HydratedLiveEvent[],
  weights: GenreWeights,
  minAffinity: number
): ScoredEvent[] {
  return events
    .map((event) => ({ event, ...scoreEventAffinity(event, weights) }))
    .filter((scored) => scored.affinity >= minAffinity)
    .sort((a, b) => {
      if (b.affinity !== a.affinity) return b.affinity - a.affinity;
      return a.event.event_date.localeCompare(b.event.event_date);
    });
}
