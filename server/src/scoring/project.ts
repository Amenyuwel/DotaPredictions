import type { DecodedProjection } from "./decode.js"
import { cdfOf, dirichletReweight, makeRng, sampleIndex } from "./random.js"

/**
 * E[best series], and how uncertain it is.
 *
 * The objective is not mean x games. A period scores the top TWO games within a
 * series and then keeps the BEST series, so it is an expected maximum over an
 * order statistic. Three consequences the arithmetic has to preserve:
 *
 *  - Variance is an asset. Two players with the same average are not
 *    equivalent, because only the ceiling is ever recorded.
 *  - Games played barely matters. More series is more attempts at a good one,
 *    with heavy diminishing returns.
 *  - You cannot compute any of it from per-player means. It runs over the
 *    observed sample, resampled.
 */

export interface ProjectionOptions {
  /** Simulated periods to score. */
  sims: number
  /** Bootstrap replicates for the interval. 0 skips it. */
  boot: number
  seed: number
  /** Multiplier applied to the last game of a series that went the distance. */
  deciderBonus?: number
}

export interface Projected {
  score: number
  ci: { lo: number; hi: number }
  sd: number
}

/**
 * Recency weights, combining age with evidence quality.
 *
 * The engine decays stat means and the bootstrap at the same half-life; drawing
 * a six-month-old game as often as one from this week is how a team that just
 * changed form looks unchanged.
 */
export function recencyWeights(
  startTime: Float64Array,
  gameWeight: Float64Array,
  halfLifeDays: number,
  asOfSeconds: number,
): Float64Array {
  const out = new Float64Array(startTime.length)
  const halfLifeSeconds = halfLifeDays * 86400
  for (let i = 0; i < startTime.length; i++) {
    const age = Math.max(asOfSeconds - startTime[i]!, 0)
    out[i] = Math.pow(0.5, age / halfLifeSeconds) * (gameWeight[i] ?? 1)
  }
  return out
}

/**
 * E[best series] for one pool of observed game scores.
 *
 * The schedule comes from the simulation, not from history: observed games are
 * a pool to draw from, and `series`/`decider` say how many games each series
 * has and whether it went the distance. A games total could not express either.
 *
 * Exported, and returning the mean rather than the per-simulation array,
 * because the banner search needs tens of thousands of these and nothing else
 * `project` does. It screens candidates against a CDF it built once and a small
 * sim budget, then rescores the finalists through `project` for their interval;
 * at 47,520 candidates an allocation apiece is the entire cost.
 *
 * `rng` is the caller's, deliberately. A search that seeds it identically for
 * every candidate compares them on the SAME simulated schedule drawing the SAME
 * games, which is what makes a small budget separate banners rather than noise.
 */
export function expectedBestSeries(
  pool: Float64Array,
  cdf: Float64Array,
  projection: DecodedProjection,
  rng: () => number,
  sims: number,
  deciderBonus: number,
): number {
  const { series, decider, maxSeries, nShapeSamples } = projection
  if (sims <= 0 || pool.length === 0) return 0
  let total = 0

  for (let s = 0; s < sims; s++) {
    // Draw a simulated period rather than walking them in order, so `sims` can
    // be tuned for latency without biasing toward early simulations.
    const sim = Math.min(Math.floor(rng() * nShapeSamples), nShapeSamples - 1)
    let best = 0

    for (let k = 0; k < maxSeries; k++) {
      const games = series[sim * maxSeries + k]!
      if (games <= 0) continue

      // Top two games in the series. Tracking the best two directly beats
      // sorting: a series is at most five games.
      let top1 = -Infinity
      let top2 = -Infinity
      for (let g = 0; g < games; g++) {
        let value = pool[sampleIndex(cdf, rng())]!
        // `the Clutch` fires on the last possible game of a series, and under a
        // top-two rule an amplified decider is also likelier to be counted --
        // so it is applied to that game, not as a flat rate on the total.
        if (deciderBonus && g === games - 1 && decider[sim * maxSeries + k]) {
          value *= 1 + deciderBonus
        }
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo)
}

export function project(
  pool: Float64Array,
  weights: Float64Array,
  projection: DecodedProjection,
  opts: ProjectionOptions,
): Projected {
  if (pool.length === 0) return { score: 0, ci: { lo: 0, hi: 0 }, sd: 0 }

  const deciderBonus = opts.deciderBonus ?? 0
  const score = expectedBestSeries(
    pool,
    cdfOf(weights),
    projection,
    makeRng(opts.seed),
    opts.sims,
    deciderBonus,
  )

  if (opts.boot <= 0) return { score, ci: { lo: score, hi: score }, sd: 0 }

  // A projection from 40 observed games and one from 112 are not the same
  // claim, and a point estimate hides the difference. Dirichlet noise
  // re-weights the same observations, so the league and recency weighting
  // survives every replicate.
  const rng = makeRng(opts.seed + 1)
  const scratch = new Float64Array(weights.length)
  const draws: number[] = []
  for (let b = 0; b < opts.boot; b++) {
    const reweighted = dirichletReweight(rng, weights, scratch)
    draws.push(
      expectedBestSeries(
        pool,
        cdfOf(reweighted),
        projection,
        makeRng(opts.seed + 2 + b),
        Math.max(1, Math.floor(opts.sims / 4)),
        deciderBonus,
      ),
    )
  }
  draws.sort((a, b) => a - b)

  const m = draws.reduce((t, x) => t + x, 0) / draws.length
  const variance = draws.reduce((t, x) => t + (x - m) ** 2, 0) / Math.max(draws.length - 1, 1)

  return {
    score,
    ci: { lo: percentile(draws, 0.05), hi: percentile(draws, 0.95) },
    sd: Math.sqrt(variance),
  }
}
