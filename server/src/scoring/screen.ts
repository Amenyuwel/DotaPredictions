import type { DecodedProjection } from "./decode.js"
import { sampleIndex } from "./random.js"

/**
 * The same simulated periods, drawn once and replayed against every candidate.
 *
 * This exists for the banner search and for nothing else. That search compares
 * tens of thousands of banners for one unit, and every one of them is scored
 * against the SAME pool of observed games under the SAME recency weights -- only
 * the emblem multipliers differ. So the schedule (`series`, `decider`) and the
 * games drawn off it (`cdf`, the generator) are identical for every candidate,
 * and re-rolling them per candidate was most of the screen's runtime: at 240
 * simulations that is about 2,400 generator calls and 2,400 binary searches
 * thrown away and repeated 47,520 times.
 *
 * Two things follow, and the second is the more important one:
 *
 *  - Scoring a candidate becomes a walk over a flat index array, which is
 *    roughly ten times cheaper than drawing it.
 *  - Every candidate is compared on identical games. That is common random
 *    numbers, and it is what lets a couple of hundred simulations separate two
 *    banners when a couple of hundred INDEPENDENT simulations could not: the
 *    sampling error is shared rather than added.
 *
 * A plan is a recording of `expectedBestSeries`, not a second opinion about
 * what a simulated period is. `test/screen.test.ts` asserts the two agree to
 * the bit on the same seed, the way `tests/test_projection.py` pins the
 * engine's vectorised scorer against its reference loop.
 */

export interface DrawPlan {
  sims: number
  /** Games in each simulated series, flattened across every simulation. */
  lengths: Int32Array
  /** Whether each of those series went the full distance. */
  decider: Uint8Array
  /** Where each simulation's series begin in `lengths`. Length `sims + 1`. */
  seriesStart: Int32Array
  /** The pool row each drawn game reads, in the order the series consume them. */
  rows: Int32Array
  /** Applied to the last game of a series that went the distance. */
  deciderBonus: number
}

export function drawPlan(
  cdf: Float64Array,
  projection: DecodedProjection,
  rng: () => number,
  sims: number,
  deciderBonus: number,
): DrawPlan {
  const { series, decider, maxSeries, nShapeSamples } = projection
  const lengths: number[] = []
  const deciders: number[] = []
  const rows: number[] = []
  const seriesStart = new Int32Array(sims + 1)

  for (let s = 0; s < sims; s++) {
    seriesStart[s] = lengths.length
    // Draw a simulated period rather than walking them in order, so `sims` can
    // be tuned for latency without biasing toward early simulations. Same call
    // order as `expectedBestSeries`, which is what makes the two agree.
    const sim = Math.min(Math.floor(rng() * nShapeSamples), nShapeSamples - 1)
    for (let k = 0; k < maxSeries; k++) {
      const games = series[sim * maxSeries + k]!
      if (games <= 0) continue
      lengths.push(games)
      deciders.push(decider[sim * maxSeries + k] ? 1 : 0)
      for (let g = 0; g < games; g++) rows.push(sampleIndex(cdf, rng()))
    }
  }
  seriesStart[sims] = lengths.length

  return {
    sims,
    lengths: Int32Array.from(lengths),
    decider: Uint8Array.from(deciders),
    seriesStart,
    rows: Int32Array.from(rows),
    deciderBonus,
  }
}

/** E[best series] for one pool against a plan already drawn. */
export function scorePlan(pool: Float64Array, plan: DrawPlan): number {
  const { sims, lengths, decider, seriesStart, rows, deciderBonus } = plan
  if (sims <= 0 || pool.length === 0) return 0

  let total = 0
  let cursor = 0
  for (let s = 0; s < sims; s++) {
    let best = 0
    for (let k = seriesStart[s]!; k < seriesStart[s + 1]!; k++) {
      const games = lengths[k]!
      // Top two games in the series. Tracking the best two directly beats
      // sorting: a series is at most five games.
      let top1 = -Infinity
      let top2 = -Infinity
      for (let g = 0; g < games; g++) {
        let value = pool[rows[cursor++]!]!
        // `the Clutch` fires on the last possible game of a series, and under a
        // top-two rule an amplified decider is also likelier to be counted --
        // so it is applied to that game, not as a flat rate on the total.
        if (deciderBonus && g === games - 1 && decider[k]) value *= 1 + deciderBonus
        if (value > top1) {
          top2 = top1
          top1 = value
        } else if (value > top2) {
          top2 = value
        }
      }
      const seriesScore = games >= 2 ? top1 + top2 : top1
      if (seriesScore > best) best = seriesScore
    }
    total += best
  }
  return total / sims
}
