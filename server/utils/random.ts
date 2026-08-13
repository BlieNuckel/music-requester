/**
 * Source of randomness. Defaults to `Math.random` everywhere; callers pass their own so
 * a test can pin an individual decision instead of stubbing the global for all of them.
 */
export type Rng = () => number;

/** Pick items via weighted random without replacement */
export function weightedRandomPick<T>(
  items: T[],
  getWeight: (item: T) => number,
  count: number,
  rng: Rng = Math.random
): T[] {
  const pool = items.map((item) => ({ item, weight: getWeight(item) }));
  const picked: T[] = [];

  for (let i = 0; i < count && pool.length > 0; i++) {
    const totalWeight = pool.reduce((sum, p) => sum + p.weight, 0);
    let r = rng() * totalWeight;

    for (let j = 0; j < pool.length; j++) {
      r -= pool[j].weight;
      if (r <= 0) {
        picked.push(pool[j].item);
        pool.splice(j, 1);
        break;
      }
    }
  }

  return picked;
}

/** Fisher-Yates shuffle */
export function shuffle<T>(arr: T[], rng: Rng = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
