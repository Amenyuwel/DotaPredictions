import type { Scoring } from "../validate.js"

/**
 * What a named banner costs in reroll tokens, and whether the period's budget
 * covers it.
 *
 * The client's two rerolls are both random and neither is a choice:
 *
 *  - a STAT reroll lands on a stat of that emblem's colour which is new and not
 *    already on the banner;
 *  - a TRAIT reroll lands on a different trait.
 *
 * So "roll this emblem into Creep Score" is not one token. The banner always
 * carries exactly one stat per slot, so a slot of colour c always has
 * `stats(c) - slots(c)` stats it could land on -- three for a red Core slot,
 * where six reds exist and the banner holds three of them. Each roll is a fresh
 * draw from that same pool, which makes the number of rolls to reach a NAMED
 * stat geometric with mean equal to the pool size. Traits are the same shape
 * with a pool of `traits - 1`.
 *
 * Quality never enters, because quality cannot be rerolled. That is why this
 * prices the stats and traits of a goal and never its tiers -- the tiers are
 * what you crafted, and no number of tokens changes them.
 *
 * Two things it assumes, both stated rather than buried:
 *
 *  1. **Draws are uniform over the pool.** The client publishes no weighting.
 *     If some stats are rarer this understates the cost of the rare ones.
 *  2. **Every emblem starts wrong.** It prices a banner built from scratch, so
 *     it is an upper bound for anyone whose current banner already carries one
 *     of the stats or traits the goal wants.
 */
export interface RerollCost {
  /** Stats a reroll could land on, per slot, in banner order. */
  statPools: number[]
  /** Traits a reroll could land on. The same for every slot. */
  traitPool: number
  /** Expected tokens to reach a named banner from a banner that shares nothing
   * with it. Exact, not simulated: the mean of a geometric is its pool size. */
  expected: number
  /** The period's budget, or null where the client's number was never
   * transcribed. */
  tokens: number | null
  /** P(the banner is reached within the budget), or null without one. */
  withinBudget: number | null
}

export function rerollCost(
  slotColors: string[],
  scoring: Scoring,
  tokens: number | null | undefined,
): RerollCost | null {
  const traitPool = Object.keys(scoring.traits).length - 1
  if (traitPool < 1) return null

  // Stats of each colour, and how many slots of that colour the banner carries.
  // Both sides are needed: the pool is what exists minus what is already worn,
  // and the second half is the no-duplicate rule doing the work.
  const perColor = new Map<string, number>()
  for (const stat of Object.values(scoring.stats)) {
    perColor.set(stat.color, (perColor.get(stat.color) ?? 0) + 1)
  }
  const worn = new Map<string, number>()
  for (const color of slotColors) worn.set(color, (worn.get(color) ?? 0) + 1)

  const statPools: number[] = []
  for (const color of slotColors) {
    const pool = (perColor.get(color) ?? 0) - (worn.get(color) ?? 0)
    // A colour with no room to reroll into cannot be priced, and a pool of zero
    // is not a free banner -- it is a banner whose stats are already forced.
    if (pool < 1) return null
    statPools.push(pool)
  }

  const expected =
    statPools.reduce((sum, pool) => sum + pool, 0) + slotColors.length * traitPool

  const budget = typeof tokens === "number" && Number.isFinite(tokens) ? tokens : null

  return {
    statPools,
    traitPool,
    expected,
    tokens: budget,
    withinBudget: budget === null ? null : withinBudget(statPools, traitPool, budget),
  }
}

/**
 * P(sum of the geometric draws lands at or under the budget).
 *
 * Convolved exactly rather than simulated. Each roll is independent with its
 * own success chance, the counts are small, and a Monte Carlo estimate of a
 * number this cheap would add noise to an answer that has enough of it.
 *
 * The budget bounds the work: probability mass past it is the failure case and
 * is never needed in detail, so the table stops there.
 */
function withinBudget(statPools: number[], traitPool: number, budget: number): number {
  const pools = [...statPools, ...statPools.map(() => traitPool)]
  if (pools.length > budget) return 0

  // `mass[t]` = P(spent exactly t tokens so far). One token minimum per roll,
  // so the table fills from the left and everything past the budget is dropped
  // as it goes -- what leaves the table is exactly the probability of running
  // out, which is the complement being returned.
  let mass = new Float64Array(budget + 1)
  mass[0] = 1
  for (const pool of pools) {
    const p = 1 / pool
    const next = new Float64Array(budget + 1)
    for (let spent = 0; spent <= budget; spent++) {
      const held = mass[spent]!
      if (held === 0) continue
      // P(this roll takes k tries) = (1-p)^(k-1) * p, k = 1, 2, ...
      let chance = p
      for (let k = 1; spent + k <= budget; k++) {
        next[spent + k] = next[spent + k]! + held * chance
        chance *= 1 - p
      }
    }
    mass = next
  }

  let total = 0
  for (let spent = 0; spent <= budget; spent++) total += mass[spent]!
  return total
}
