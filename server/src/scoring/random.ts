/**
 * Deterministic randomness.
 *
 * Every number this server reports is a Monte Carlo estimate, so the generator
 * has to be seeded and reproducible: the same request must return the same
 * answer, or a user watching a number change while they change nothing has no
 * reason to trust any of it.
 *
 * This is NOT numpy's PCG64 and cannot be. That is why the parity checkpoint
 * against the engine is split -- exact agreement on the deterministic layer, a
 * tolerance on the sampled one. Trying to match sampled digits across two
 * languages is a hunt for a bug that does not exist.
 */

/** mulberry32: small, fast, and good enough for resampling an observed pool. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Cumulative distribution for weighted sampling, normalised. */
export function cdfOf(weights: Float64Array): Float64Array {
  const out = new Float64Array(weights.length)
  let total = 0
  for (let i = 0; i < weights.length; i++) {
    total += Math.max(weights[i]!, 0)
    out[i] = total
  }
  if (total <= 0) {
    // Degenerate weights would silently freeze the bootstrap on one observation.
    for (let i = 0; i < out.length; i++) out[i] = (i + 1) / out.length
    return out
  }
  for (let i = 0; i < out.length; i++) out[i]! /= total
  return out
}

/** Index of the first cdf entry >= u. Binary search, so the pool size is free. */
export function sampleIndex(cdf: Float64Array, u: number): number {
  let lo = 0
  let hi = cdf.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cdf[mid]! < u) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Gamma(shape, 1) by Marsaglia-Tsang.
 *
 * Needed only because the confidence interval is a Bayesian bootstrap and Node
 * has no Dirichlet. Shapes below 1 use the standard boost, though every call
 * here passes shape 1.
 */
function gamma(rng: () => number, shape: number): number {
  if (shape < 1) return gamma(rng, shape + 1) * Math.pow(rng(), 1 / shape)
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x = 0
    let v = 0
    do {
      x = gaussian(rng)
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = rng()
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

/** Box-Muller. One draw per call; the second is discarded, which costs less
 * than the state needed to keep it. */
function gaussian(rng: () => number): number {
  const u = Math.max(rng(), Number.MIN_VALUE)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

/**
 * Dirichlet(1,...,1) noise multiplied into existing weights.
 *
 * A Bayesian bootstrap re-weights the SAME observations rather than re-drawing
 * them, which is what keeps the recency and evidence weighting intact across
 * replicates. Re-drawing would throw it away and widen the interval for the
 * wrong reason.
 */
export function dirichletReweight(
  rng: () => number,
  base: Float64Array,
  out: Float64Array,
): Float64Array {
  let total = 0
  for (let i = 0; i < base.length; i++) {
    const g = gamma(rng, 1)
    out[i] = base[i]! * g
    total += out[i]!
  }
  if (total > 0) for (let i = 0; i < out.length; i++) out[i]! /= total
  return out
}
