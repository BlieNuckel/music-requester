/**
 * The one line that splits a user's similar-artist graph into the two bands the carousel
 * recommends from. Explore takes the far side, the personal source takes the near side, and
 * the line itself is `genreOverlapThreshold`.
 *
 * It lives here, on its own, because it used to be written out at each of the three places
 * that read it — twice to partition and once to label the trace — and three copies of a
 * comparison is three chances for the bands to stop being complementary.
 */

/** Jaccard similarity of two genre sets (0 = disjoint, 1 = identical). */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * An artist we know no genres for is in neither band. It is not near — nothing says it is —
 * and calling it far would make every untagged artist a genre jump, which is how "similar
 * vibe, different genre" turns into "an artist nobody has tagged".
 */
export function isDistantGenre(
  genres: Set<string>,
  overlap: number,
  threshold: number
): boolean {
  return genres.size > 0 && overlap <= threshold;
}

export function isNearGenre(
  genres: Set<string>,
  overlap: number,
  threshold: number
): boolean {
  return genres.size > 0 && overlap > threshold;
}
