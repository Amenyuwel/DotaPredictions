import type { Emblem, Scoring } from "../validate.js"
import { combine, multipliers, type SlotStats } from "./banner.js"
import type { DecodedProjection } from "./decode.js"
import { searchBanner, type ScoredArrangement } from "./optimize.js"
import { project } from "./project.js"
import { cdfOf, makeRng } from "./random.js"
import { drawPlan, scorePlan } from "./screen.js"

/**
 * The banner to aim for, over the whole catalog rather than what you own.
 *
 * `/api/banner/optimize` answers "what should I wear tonight". This answers
 * "what am I hunting", and the difference is the search space: 450 generatable
 * emblems in five slots is about 10^13 ordered arrangements, which is why the
 * owned-emblem search refuses to look at the catalog at all.
 *
 * It is tractable here because of one fact about the scoring rules: **a
 * multiplier never depends on the stat.** `multipliers` reads tier, trait and
 * the neighbours' traits, and nothing else -- colour is a property of the stat
 * and pays nothing. So the choice splits cleanly in two:
 *
 *  - WHICH QUALITIES AND TRAITS, which fixes a vector of five multipliers;
 *  - WHICH STATS, which fixes five per-game value vectors.
 *
 * and any stat may be placed at any position, because what we are choosing is
 * an emblem to go and roll, not one we already hold.
 *
 * That makes the multiplier half finite and small. See `paretoProfiles`.
 */

/** One tier/trait configuration, and what it pays each position. */
export interface MultiplierProfile {
  tiers: string[]
  traits: string[]
  /** In banner order. */
  multipliers: number[]
  /** Colour -> that colour's position indices, largest multiplier first. */
  byColor: Map<string, number[]>
}

/**
 * Every tier/trait configuration worth considering, which is about twenty.
 *
 * Enumerating all of them is 5^5 tiers x 5^5 traits = 9,765,625 ordered
 * configurations for a five-slot banner. Two exact reductions cut that to a
 * list short enough to print:
 *
 * **Tiers are forced unless Fractal is on the banner.** Quality is the only
 * thing a tier pays, it rises with the tier, and Fractal ("all qualities
 * differ") is the one trait whose bonus reads the others' tiers. So a trait
 * vector with no Fractal in it wants five Tier Vs and nothing else is worth
 * scoring; a trait vector with one wants either all five tiers distinct, so
 * Fractal fires, or all Tier V, so it does not. Everything in between is beaten
 * slot for slot by one of those two.
 *
 * **Dominated profiles can never win.** Sort each configuration's multipliers
 * largest first, WITHIN EACH COLOUR. If profile A is at least profile B at
 * every rank of every colour, then for any stat values -- pair each colour's
 * largest multiplier with that colour's most valuable stat either way -- A's
 * banner scores at least B's game for game, so B cannot be the answer for
 * anybody.
 *
 * Within each colour, because a slot's colour is fixed by role and a stat
 * belongs to exactly one colour. Stats are therefore NOT freely assignable
 * across positions, only within a colour group, and sorting all five together
 * would compare profiles on a swap the game does not allow -- pruning a profile
 * that wins on the banner that can actually be built.
 *
 * The domination argument needs the stat values to be non-negative, which is
 * the caller's to check: `deaths` pays 1,950 less 195 per death and turns
 * negative above ten. `targetSearch` drops any stat with a negative game rather
 * than quietly leaning on an assumption that does not hold.
 */
export function paretoProfiles(
  scoring: Scoring,
  slotColors: string[],
  /** The qualities the banner is allowed to be built from, as a multiset in any
   * order. Omitted means "any", which is the ceiling: quality cannot be
   * rerolled, so an unconstrained answer is the banner you would hold if every
   * craft had come up Tier V. A goal passes its own row instead. */
  qualities?: string[],
  /** Treat `qualities` as the order the banner is worn in rather than as a hand
   * to arrange. See `TargetOptions.fixedQualityOrder`. */
  fixedOrder?: boolean,
): MultiplierProfile[] {
  // Enumerating the front walks a quarter of a million configurations, and it
  // depends on nothing but the colour row and the scoring table -- both fixed
  // for a run and a role. Two banners for the same role would otherwise pay for
  // it twice.
  const key = `${slotColors.join(",")}:${qualities?.join(",") ?? "*"}:${fixedOrder ? "fixed" : "any"}:${JSON.stringify(scoring.quality)}:${JSON.stringify(scoring.traits)}`
  const held = FRONTS.get(key)
  if (held) return held
  const front = buildProfiles(slotColors, scoring, qualities, fixedOrder)
  FRONTS.set(key, front)
  return front
}

const FRONTS = new Map<string, MultiplierProfile[]>()

function buildProfiles(
  slotColors: string[],
  scoring: Scoring,
  qualities?: string[],
  fixedOrder?: boolean,
): MultiplierProfile[] {
  const slots = slotColors.length
  const tiers = Object.keys(scoring.quality)
  const traits = Object.keys(scoring.traits)
  if (tiers.length === 0 || traits.length === 0) return []
  if (qualities && qualities.length !== slots) return []

  // Highest quality first, so "all Tier V" is `best` and the distinct-tier case
  // draws from the same list without assuming the config's key order.
  const ranked = [...tiers].sort((a, b) => (scoring.quality[b] ?? 0) - (scoring.quality[a] ?? 0))
  const best = ranked[0]!

  const candidates: MultiplierProfile[] = []
  const emit = (tierRow: string[], traitRow: string[]) => {
    const banner = tierRow.map((tier, i) => stub(tier, traitRow[i]!))
    const mults = multipliers(banner, scoring)
    // Positions of each colour, best-paying first. The search pairs a colour's
    // stats with its own positions in this order and never reaches across a
    // colour, because a red stat cannot sit in a green slot.
    const byColor = new Map<string, number[]>()
    for (const color of new Set(slotColors)) {
      byColor.set(
        color,
        slotColors
          .map((c, i) => (c === color ? i : -1))
          .filter((i) => i >= 0)
          .sort((a, b) => mults[b]! - mults[a]!),
      )
    }
    candidates.push({ tiers: tierRow, traits: traitRow, multipliers: mults, byColor })
  }

  for (const traitRow of rows(traits, slots)) {
    if (qualities) {
      // A goal fixes WHICH qualities are on the banner and leaves open only
      // where they sit. Both halves of the unconstrained argument are gone with
      // it: "all Tier V" is not available unless the goal asked for it, and the
      // Fractal case is not a separate branch -- whether every quality differs
      // is a property of the row the goal named, not a choice the search makes.
      // Fixed means exactly one tier row: the one that was sent. The reader put
      // those tiers on those rows, and an answer that moved them would read as
      // the click having gone somewhere else.
      if (fixedOrder) emit([...qualities], traitRow)
      else for (const tierRow of arrangements(qualities)) emit(tierRow, traitRow)
      continue
    }
    emit(new Array<string>(slots).fill(best), traitRow)
    // Only Fractal reads the other tiers, so only Fractal makes a
    // lower-quality emblem worth placing.
    if (!traitRow.includes("fractal")) continue
    for (const tierRow of distinct(ranked, slots)) emit(tierRow, traitRow)
  }

  return pareto(candidates, slotColors)
}

/** Keep one profile per Pareto-optimal per-colour multiplier vector. */
function pareto(
  candidates: MultiplierProfile[],
  slotColors: string[],
): MultiplierProfile[] {
  // Positions grouped by colour, in first-appearance order. The comparison key
  // is each group's multipliers sorted large-first, laid end to end -- so two
  // profiles are compared rank against rank inside a colour and never across
  // one.
  const groups = [...new Set(slotColors)].map((color) =>
    slotColors.map((c, i) => (c === color ? i : -1)).filter((i) => i >= 0),
  )
  const sorted = candidates.map((p) => ({
    profile: p,
    // Rounded for the COMPARISON only; the profile keeps what `multipliers`
    // returned. Every quality and trait bonus is a multiple of 0.1, so two
    // configurations that both pay 2.4 can still differ in the last bit -- and
    // an epsilon-free `>=` then fails to notice one profile beating another,
    // which leaves a dominated profile in the front. That is not a wrong
    // answer, only a slower search, which is exactly the kind of bug that
    // survives: `test/target.test.ts` pins the front's size.
    desc: groups.flatMap((positions) =>
      positions
        .map((i) => p.multipliers[i]!)
        .sort((a, b) => b - a)
        .map((m) => Math.round(m * 1e6) / 1e6),
    ),
  }))
  const front: typeof sorted = []
  for (const candidate of sorted) {
    // A tie is a duplicate rather than a rival: `dominates` is >= in every
    // position, so an identical vector already in the front covers this one.
    if (front.some((held) => dominates(held.desc, candidate.desc))) continue
    for (let i = front.length - 1; i >= 0; i--) {
      if (dominates(candidate.desc, front[i]!.desc)) front.splice(i, 1)
    }
    front.push(candidate)
  }
  return front.map((f) => f.profile)
}

const dominates = (a: number[], b: number[]) => a.every((value, i) => value >= b[i]!)

/** An emblem that exists only to be priced. `multipliers` reads tier and trait
 * and nothing else, so the rest is deliberately not invented -- there is no
 * stat here to be mistaken for a recommendation. */
const stub = (tier: string, trait: string): Emblem =>
  ({ emblemId: `${tier}:${trait}`, stat: "", tier, trait }) as Emblem

/** Every ordered row of `values`, length `slots`. */
function* rows(values: string[], slots: number): Generator<string[]> {
  if (slots === 0) {
    yield []
    return
  }
  for (const rest of rows(values, slots - 1)) {
    for (const value of values) yield [value, ...rest]
  }
}

/**
 * Every DISTINCT ordering of a multiset.
 *
 * Distinct because a goal's row repeats qualities -- two Tier IVs in the
 * Realistic rung -- and their two orderings are the same banner. Swapping them
 * would multiply the front's input by the repeats for nothing, and the pruning
 * that follows would spend its time discarding copies.
 */
function* arrangements(values: string[]): Generator<string[]> {
  if (values.length === 0) {
    yield []
    return
  }
  const seen = new Set<string>()
  for (let i = 0; i < values.length; i++) {
    const head = values[i]!
    if (seen.has(head)) continue
    seen.add(head)
    const rest = values.filter((_, j) => j !== i)
    for (const tail of arrangements(rest)) yield [head, ...tail]
  }
}

/** Every ordered row of `slots` DISTINCT values, for the Fractal case. */
function* distinct(values: string[], slots: number): Generator<string[]> {
  if (slots === 0) {
    yield []
    return
  }
  for (let i = 0; i < values.length; i++) {
    const rest = values.filter((_, j) => j !== i)
    for (const tail of distinct(rest, slots - 1)) yield [values[i]!, ...tail]
  }
}

export interface TargetOptions {
  /** The colour of each slot, in banner order. Fixed by role; it decides which
   * six stats each slot can hold and so the whole shape of the search. */
  slotColors: string[]
  /** The qualities the banner may be built from, as a multiset. Omitted means
   * the ceiling -- every craft a Tier V. */
  qualities?: string[]
  /** Take `qualities` as an ORDER rather than as a hand: slot 1 is the first
   * of them, and the search may not move it. For the custom goal, where the
   * reader put a tier on a row and expects to find it there. */
  fixedQualityOrder?: boolean
  /** Simulated periods per candidate in the screen. */
  screenSims: number
  /** Emblem sets taken through to the exact ordering pass. */
  keep: number
  /** Candidates carried from the mean pass into the Monte Carlo screen. */
  shortlist: number
  /** Simulated periods and bootstrap replicates for the finalists. */
  sims: number
  boot: number
  seed: number
  deciderBonus?: number
}

export interface TargetSearch {
  /** Tier/trait configurations on the Pareto front, all of them compared. */
  profiles: number
  /** Stats the candidate sets were drawn from, after drops. */
  statsConsidered: number
  /** Stats left out because the front's argument does not cover them. */
  statsDropped: string[]
  /** Profile x stat-set candidates built and priced on their mean. */
  candidates: number
  /** How many of those reached the Monte Carlo screen. */
  screened: number
  /** Orders examined in the exact pass, across every finalist. */
  arrangements: number
  rescored: number
  best: ScoredArrangement | null
  /** The best banner of each OTHER emblem set, descending. */
  alternatives: ScoredArrangement[]
  /** The winning set in its worst order, so what ORDER is worth is measured. */
  worstOrder: ScoredArrangement | null
}

const EMPTY: TargetSearch = {
  profiles: 0,
  statsConsidered: 0,
  statsDropped: [],
  candidates: 0,
  screened: 0,
  arrangements: 0,
  rescored: 0,
  best: null,
  alternatives: [],
  worstOrder: null,
}

/**
 * The best banner in the catalog for one slot.
 *
 * Three passes, and since the slot colours went in, all three are exact.
 *
 * 1. **The multiplier half.** `paretoProfiles` returns every tier/trait
 *    configuration that any stat values could make optimal for this colour row.
 *    Nothing outside that list is skipped for cost; it is skipped because
 *    another profile beats it at every rank of every colour.
 *
 * 2. **The stat half, now over every stat.** A slot's colour fixes which six
 *    stats can sit there, so the choice is not "five distinct stats out of
 *    eighteen" -- it is a set per colour, of exactly the size that colour
 *    appears. A Core banner is three reds out of six and two greens out of six:
 *    20 x 15 = 300 sets, not 8,568. Every stat enters, so the old "a stat that
 *    pays rarely and hugely could be missing" caveat is gone. Within a colour,
 *    its stats pair with its positions by rank -- the most valuable onto the
 *    largest multiplier.
 *
 *    Every profile x stat-set pair is then priced on its recency-weighted mean,
 *    which is exact arithmetic and costs a dot product, and the top `shortlist`
 *    go on to the Monte Carlo screen. The mean is the wrong objective -- E[best
 *    series] rewards the right tail and the mean cannot see it -- so this
 *    decides who is in the running, never who wins. `candidates` and `screened`
 *    report both numbers.
 *
 * 3. **The order**, by handing each finalist set to `searchBanner` -- the same
 *    search, screen and full rescoring the owned-emblem direction uses, and
 *    under the same colour row, so it permutes within a colour and never
 *    across. Rank pairing gets stats onto the right multipliers; it does not
 *    know that moving a Vampiric changes its neighbours, so the arrangement is
 *    re-derived rather than trusted.
 *
 * A stat whose per-game value ever goes negative is dropped before any of this.
 * `deaths` pays 1,950 less 195 per death, so an eleven-death game is worth less
 * than nothing -- and the domination in step 1 assumes a bigger multiplier is
 * never worse, which stops being true the moment a value can be negative.
 * Dropping it is the honest move: the front would otherwise be quietly wrong
 * for exactly the stat you would most want it to be right about. A colour can
 * lose a stat and still have enough to fill its slots; if it cannot, the search
 * returns nothing rather than an illegal banner.
 */
export function targetSearch(
  catalog: Map<string, Emblem>,
  slot: SlotStats,
  projection: DecodedProjection,
  scoring: Scoring,
  weights: Float64Array,
  opts: TargetOptions,
): TargetSearch {
  if (slot.nGames === 0) return EMPTY

  const slots = opts.slotColors.length
  const profiles = paretoProfiles(
    scoring,
    opts.slotColors,
    opts.qualities,
    opts.fixedQualityOrder,
  )
  if (profiles.length === 0) return EMPTY

  const statsDropped: string[] = []
  const ranked: { stat: string; mean: number }[] = []
  let totalWeight = 0
  for (let row = 0; row < slot.nGames; row++) totalWeight += weights[row] ?? 0

  for (const [stat, values] of slot.values) {
    let negative = false
    let sum = 0
    for (let row = 0; row < slot.nGames; row++) {
      const value = values[row]!
      if (value < 0) negative = true
      sum += (weights[row] ?? 0) * value
    }
    if (negative) {
      statsDropped.push(stat)
      continue
    }
    // Ranked on the recency-weighted mean, which is the weighting the
    // projection itself draws under -- not the raw average, which would rank a
    // stat by games the answer barely reads.
    ranked.push({ stat, mean: totalWeight > 0 ? sum / totalWeight : 0 })
  }
  ranked.sort((a, b) => b.mean - a.mean)

  // One pool per colour, each already in rank order, and how many slots of that
  // colour the row asks for. Every stat of the colour is here: the set is small
  // enough that there is nothing to shortlist.
  const need = new Map<string, number>()
  for (const color of opts.slotColors) need.set(color, (need.get(color) ?? 0) + 1)

  const colors = [...need.keys()]
  const pools = colors.map((color) =>
    ranked.filter((entry) => scoring.stats[entry.stat]?.color === color),
  )
  for (let c = 0; c < colors.length; c++) {
    // Not enough scoreable stats of one colour to fill its slots. Returning
    // nothing is the only honest move -- any banner built here would put a
    // stat on a slot that cannot hold it.
    if (pools[c]!.length < need.get(colors[c]!)!) {
      return { ...EMPTY, profiles: profiles.length, statsDropped }
    }
  }
  const statsConsidered = pools.reduce((n, pool) => n + pool.length, 0)

  const plan = drawPlan(
    cdfOf(weights),
    projection,
    makeRng(opts.seed),
    opts.screenSims,
    opts.deciderBonus ?? 0,
  )
  const scratch = new Float64Array(slot.nGames)

  /** The best screen score found for each emblem SET, keyed by its ids. */
  const bySet = new Map<string, { emblems: Emblem[]; screen: number }>()
  /** Every candidate with its mean value, before the shortlist is taken. */
  const priced: { emblems: Emblem[]; mults: number[]; mean: number }[] = []
  const meanOf = new Map(ranked.map((entry) => [entry.stat, entry.mean]))
  let candidates = 0

  // Every way to choose each colour's stats, independently: the colours do not
  // constrain each other, so the candidate sets are the product of the
  // per-colour choices.
  const perColor = colors.map((color, c) => [
    ...combinations(pools[c]!.length, need.get(color)!),
  ])

  for (const picks of product(perColor)) {
    for (const profile of profiles) {
      // Each colour's pool is sorted by mean and its `byColor` positions by
      // multiplier, so this walks both in rank order WITHIN the colour: that
      // colour's most valuable stat lands on its best-paying slot. The
      // rearrangement inequality makes that the best pairing for a fixed
      // profile, and step 3 re-derives the order regardless.
      const banner = new Array<Emblem>(slots)
      let complete = true
      for (let c = 0; c < colors.length && complete; c++) {
        const positions = profile.byColor.get(colors[c]!)!
        const chosen = picks[c]!
        for (let rank = 0; rank < positions.length; rank++) {
          const position = positions[rank]!
          const stat = pools[c]![chosen[rank]!]!.stat
          const emblem = catalog.get(
            [stat, profile.tiers[position], profile.traits[position]].join(":"),
          )
          if (!emblem) {
            complete = false
            break
          }
          banner[position] = emblem
        }
      }
      if (!complete) continue

      candidates += 1
      // Priced on the recency-weighted mean first, which is a dot product of
      // five numbers rather than a walk over every drawn game. Mid's row has
      // three colours and so 303,750 candidates; at Monte Carlo prices that is
      // eight seconds, and at this price it is milliseconds.
      //
      // This is a narrowing, not the answer: E[best series] rewards the right
      // tail and the mean cannot see it, so the mean's order and the real order
      // differ. What it can do is say which candidates are not in the running
      // at all, and only the shortlist is then screened properly.
      let mean = 0
      const mults = multipliers(banner, scoring)
      for (let i = 0; i < slots; i++) mean += mults[i]! * (meanOf.get(banner[i]!.stat) ?? 0)
      priced.push({ emblems: banner, mults, mean })
    }
  }

  if (priced.length === 0) {
    return { ...EMPTY, profiles: profiles.length, statsConsidered, statsDropped }
  }

  priced.sort((a, b) => b.mean - a.mean)
  const shortlist = priced.slice(0, Math.max(opts.shortlist, opts.keep))

  for (const candidate of shortlist) {
    const screen = scorePlan(
      combine(slot, candidate.emblems, candidate.mults, scratch),
      plan,
    )
    // Keyed by the SET, because two profiles can name the same five emblems in
    // different positions and step 3 would then search one set twice.
    const key = candidate.emblems
      .map((e) => e.emblemId)
      .sort()
      .join("|")
    const held = bySet.get(key)
    if (!held || screen > held.screen) bySet.set(key, { emblems: candidate.emblems, screen })
  }

  if (bySet.size === 0) {
    return { ...EMPTY, profiles: profiles.length, statsConsidered, statsDropped }
  }

  const finalists = [...bySet.values()]
    .sort((a, b) => b.screen - a.screen)
    .slice(0, Math.max(opts.keep, 1))

  // The exact pass. One `searchBanner` per set, over exactly that set, so it
  // enumerates that set's orders and nothing else -- same screen, same full
  // rescoring, same mirror folding as the owned-emblem direction.
  const exact = finalists
    .map((set) =>
      searchBanner(set.emblems, slot, projection, scoring, weights, {
        slots,
        slotColors: opts.slotColors,
        // Pinned only where the caller pinned them. The ordering pass permutes
        // whole emblems, so without this it can put the Tier V the reader set
        // on row 4 onto row 2 -- legal, better, and read as the click having
        // gone somewhere else.
        slotTiers: opts.fixedQualityOrder ? (opts.qualities ?? null) : null,
        screenSims: opts.screenSims,
        keep: 1,
        sims: opts.sims,
        boot: opts.boot,
        seed: opts.seed,
        deciderBonus: opts.deciderBonus,
      }),
    )
    .filter((found) => found.best !== null)
    .sort((a, b) => b.best!.score - a.best!.score)

  const winner = exact[0]
  if (!winner?.best) {
    return {
      ...EMPTY,
      profiles: profiles.length,
      statsConsidered,
      candidates,
      screened: bySet.size,
      statsDropped,
    }
  }

  return {
    profiles: profiles.length,
    statsConsidered,
    statsDropped,
    candidates,
    screened: bySet.size,
    arrangements: exact.reduce((n, found) => n + found.arrangements, 0),
    rescored: exact.reduce((n, found) => n + found.rescored, 0),
    best: winner.best,
    alternatives: exact.slice(1).map((found) => found.best!),
    worstOrder: winner.worstOrder,
  }
}

/** Every combination of one entry from each list, in order. */
function* product<T>(lists: T[][]): Generator<T[]> {
  if (lists.length === 0) {
    yield []
    return
  }
  const [head, ...rest] = lists
  for (const tail of product(rest)) {
    for (const value of head!) yield [value, ...tail]
  }
}

/** Every way to choose `k` of `n` indices, ascending. */
function* combinations(n: number, k: number): Generator<number[]> {
  if (k === 0) {
    yield []
    return
  }
  for (let i = 0; i <= n - k; i++) {
    for (const rest of combinations(n - i - 1, k - 1)) {
      yield [i, ...rest.map((j) => j + i + 1)]
    }
  }
}
