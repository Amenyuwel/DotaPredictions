import type { Emblem, Scoring } from "../validate.js"
import { combine, multipliers, type SlotStats } from "./banner.js"
import type { DecodedProjection } from "./decode.js"
import { project } from "./project.js"
import { cdfOf, makeRng } from "./random.js"
import { drawPlan, scorePlan } from "./screen.js"

/**
 * Which banner to build out of the emblems you own.
 *
 * The inverse of `/api/player/rank`: the unit is fixed and the banner is the
 * free choice. Three properties of the problem decide the whole design.
 *
 * **It is combinatorial, not continuous.** Order is an input -- Vampiric charges
 * each neighbour -10% and Benevolent pays each +20% -- so the candidates are
 * ordered selections, not subsets. Twelve owned emblems in five slots is 95,040
 * of them.
 *
 * **A banner and its mirror image score identically.** Reversing the order maps
 * every emblem's neighbours onto the reversed position's neighbours, and the
 * whole-banner conditions (Fractal, Friendly, Unique) do not depend on order at
 * all. So exactly half of those 95,040 are duplicates, and the search keeps the
 * one whose first slot holds the lower-numbered emblem.
 *
 * **The objective cannot be evaluated 47,520 times.** E[best series] is a Monte
 * Carlo estimate; at the precision `/api/player/rank` uses, one costs about as
 * much as ranking a whole stage. So the search is two passes over the SAME
 * estimator rather than one pass over a cheaper stand-in: a screen at a small
 * sim budget, then a full rescoring of the finalists. The screen re-seeds the
 * generator identically for every candidate, so all of them are compared on one
 * simulated schedule drawing one set of games -- common random numbers, which
 * is what lets a few hundred simulations separate banners that a few hundred
 * independent simulations could not.
 *
 * What the screen cannot promise is that the true best survived it. That is why
 * `rescored` and `arrangements` both travel with the answer, and why the
 * finalists come back with intervals: an arrangement the screen misplaced by
 * less than its own sampling error was never separable from the one that beat
 * it anyway.
 */

export interface SearchOptions {
  /** Emblems on a banner in this stage. Read off the run, never inferred. */
  slots: number
  /** The colour each slot must carry, in banner order. Null only for a payload
   * published before the rule was on the wire, and then order is unconstrained
   * -- which is the old, wrong behaviour, so the route says so in its caveats. */
  slotColors: string[] | null
  /**
   * The quality each slot must carry, in banner order, or null for "anywhere".
   *
   * Only the custom goal sets it, and only because the reader put those tiers
   * on those rows themselves. Without it this pass is free to swap two emblems
   * of the same colour -- which is a better banner and the right answer to the
   * question the ladder asks, but it moves a tier the reader had just set, and
   * an edit that lands on a different row is indistinguishable from one that
   * did nothing.
   */
  slotTiers?: string[] | null
  /** Simulated periods per candidate in the screen. */
  screenSims: number
  /** Distinct emblem sets rescored at full precision. */
  keep: number
  /** Simulated periods and bootstrap replicates for the finalists. */
  sims: number
  boot: number
  seed: number
  deciderBonus?: number
}

export interface ScoredArrangement {
  /** The emblem ids in banner order, top to bottom. Identifies the row. */
  bannerId: string
  emblems: Emblem[]
  /** What the client would stamp on each emblem, in banner order. */
  multipliers: number[]
  score: number
  ci: { lo: number; hi: number }
}

export interface BannerSearch {
  /** Legal arrangements compared, after mirror images were folded together. */
  arrangements: number
  /** Distinct emblem sets among them. */
  subsets: number
  /** How many of them were rescored at full precision. */
  rescored: number
  best: ScoredArrangement | null
  /** The best arrangement of each OTHER emblem set, descending.
   *
   * One row per set rather than per arrangement, because a list of ten
   * reorderings of one set answers a question nobody asked -- the same trap the
   * engine's k-best roster search has bucket constraints for. What the order is
   * worth is reported once, by `worstOrder`, instead of ten times. */
  alternatives: ScoredArrangement[]
  /** The winning set in its WORST order, so what ORDER alone is worth is a
   * measured gap rather than a claim. Null when the set has only one order. */
  worstOrder: ScoredArrangement | null
}

const EMPTY: BannerSearch = {
  arrangements: 0,
  subsets: 0,
  rescored: 0,
  best: null,
  alternatives: [],
  worstOrder: null,
}

/** The best and worst arrangement found for one emblem set, by screen score. */
interface SetBest {
  mask: number
  best: number[]
  bestScreen: number
  worst: number[]
  worstScreen: number
}

export function searchBanner(
  inventory: Emblem[],
  slot: SlotStats,
  projection: DecodedProjection,
  scoring: Scoring,
  weights: Float64Array,
  opts: SearchOptions,
): BannerSearch {
  if (inventory.length < opts.slots || slot.nGames === 0) return EMPTY

  // One schedule and one set of drawn games for every candidate -- see
  // `screen.ts`. Built here rather than per candidate because that is both the
  // speed of the screen and the reason it separates anything at this budget.
  const plan = drawPlan(
    cdfOf(weights),
    projection,
    makeRng(opts.seed),
    opts.screenSims,
    opts.deciderBonus ?? 0,
  )
  // One buffer for every candidate. At 47,520 of them an allocation apiece is
  // the whole cost of the screen.
  const pool = new Float64Array(slot.nGames)
  const order: number[] = []
  const banner: Emblem[] = []
  const takenIndex = new Array<boolean>(inventory.length).fill(false)
  const takenStat = new Set<string>()
  const bySet = new Map<number, SetBest>()
  let arrangements = 0

  const colors = opts.slotColors
  const tiers = opts.slotTiers ?? null
  // The fold is only sound when the reversed banner is legal, which now means
  // both rows reading the same backwards: a pinned tier row that does not would
  // have its mirror discarded without ever being generated.
  const mirrorSafe =
    (colors === null ||
      colors.every((color, i) => color === colors[colors.length - 1 - i])) &&
    (tiers === null || tiers.every((tier, i) => tier === tiers[tiers.length - 1 - i]))

  const walk = (depth: number, mask: number) => {
    if (depth === opts.slots) {
      // The mirror image scores the same banner, so only one of the pair is
      // kept. Every index is distinct, so the comparison is decided at the
      // first slot and never needs the rest of the array.
      //
      // Only sound when the reversed banner is itself legal. Slot colours are
      // fixed by role and only Core's and Support's rows read the same
      // backwards -- mid is red blue green red green, whose reverse is a
      // different row -- so folding there would discard an arrangement whose
      // mirror the search never generates, and the discarded one could be the
      // answer.
      if (mirrorSafe && order[0]! > order[opts.slots - 1]!) return
      arrangements += 1

      const mults = multipliers(banner, scoring)
      const screen = scorePlan(combine(slot, banner, mults, pool), plan)

      const held = bySet.get(mask)
      if (!held) {
        bySet.set(mask, {
          mask,
          best: [...order],
          bestScreen: screen,
          worst: [...order],
          worstScreen: screen,
        })
        return
      }
      if (screen > held.bestScreen) {
        held.best = [...order]
        held.bestScreen = screen
      }
      if (screen < held.worstScreen) {
        held.worst = [...order]
        held.worstScreen = screen
      }
      return
    }

    // The colour of this slot, which is six of the eighteen stats and not a
    // preference. Checking it here rather than at depth `slots` is most of the
    // search: an inventory of twelve in five slots drops from 47,520
    // arrangements to the handful whose emblems can actually sit where they are
    // being put.
    const want = opts.slotColors?.[depth] ?? null
    const wantTier = tiers?.[depth] ?? null

    for (let i = 0; i < inventory.length; i++) {
      const emblem = inventory[i]!
      // No stat twice -- the client's rule, and the same one `/api/player/rank`
      // enforces on the way in.
      if (takenIndex[i] || takenStat.has(emblem.stat)) continue
      if (want !== null && scoring.stats[emblem.stat]?.color !== want) continue
      if (wantTier !== null && emblem.tier !== wantTier) continue
      takenIndex[i] = true
      takenStat.add(emblem.stat)
      order.push(i)
      banner.push(emblem)
      walk(depth + 1, mask | (1 << i))
      order.pop()
      banner.pop()
      takenStat.delete(emblem.stat)
      takenIndex[i] = false
    }
  }

  walk(0, 0)
  if (arrangements === 0) return EMPTY

  const full = (indices: number[]): ScoredArrangement => {
    const emblems = indices.map((i) => inventory[i]!)
    const mults = multipliers(emblems, scoring)
    const projected = project(combine(slot, emblems, mults), weights, projection, opts)
    return {
      bannerId: emblems.map((e) => e.emblemId).join("|"),
      emblems,
      multipliers: mults,
      score: projected.score,
      ci: projected.ci,
    }
  }

  const finalists = [...bySet.values()]
    .sort((a, b) => b.bestScreen - a.bestScreen)
    .slice(0, Math.max(opts.keep, 1))
  const scored = finalists
    .map((set) => ({ set, arrangement: full(set.best) }))
    .sort((a, b) => b.arrangement.score - a.arrangement.score)

  const winner = scored[0]!
  // Measured on the set that wins the FULL rescoring, not the one that led the
  // screen -- otherwise the gap could be quoted against a banner that is not on
  // screen.
  const worstOrder =
    winner.set.worst.join(",") === winner.set.best.join(",") ? null : full(winner.set.worst)

  return {
    arrangements,
    subsets: bySet.size,
    rescored: scored.length + (worstOrder ? 1 : 0),
    best: winner.arrangement,
    alternatives: scored.slice(1).map((s) => s.arrangement),
    worstOrder,
  }
}
