import type { Emblem, Scoring } from "../../../shared/run-types.js"
import type { DecodedSamples, RunIndex } from "./decode.js"

/**
 * What a banner pays, per game.
 *
 * Two rules from the client drive everything here and both are easy to get
 * wrong in the obvious direction:
 *
 *  - **Only the banner's stats score.** A player's overall quality is close to
 *    irrelevant; they are worth exactly what these few stats pay. Base values
 *    are wildly unequal -- Creep Score 3 per unit against Roshan's 1,172 -- so a
 *    raw rate means nothing until multiplied through.
 *  - **An emblem's multiplier depends on its NEIGHBOURS.** Vampiric charges each
 *    adjacent emblem and Benevolent pays each one, so position is an input.
 *    Treating the multiplier as a property of the emblem makes every ordering
 *    score identically.
 *
 * The arithmetic is split into a stat half and a multiplier half, and both
 * directions of the tool go through the same two functions. What a stat is
 * worth in a game does not depend on the banner it lands on, so `slotStatValues`
 * computes it once; `combine` is the only place a multiplier ever touches it.
 * The banner search rebuilds the second half tens of thousands of times and the
 * first half never -- and, more to the point, a banner scored by that search and
 * the same banner scored by `/api/player/rank` cannot come out differently,
 * because there is exactly one implementation of either half.
 */

/** Multiplier per emblem, in banner order: 1 + quality + own trait + neighbours.
 *
 * Written out with index loops rather than `map`/`filter`/`Set`, which is a
 * departure from the style of the rest of this file and pays for itself
 * nowhere but here: the banner search calls this once per candidate, and the
 * intermediate arrays the readable form allocates were most of its runtime. */
export function multipliers(banner: Emblem[], scoring: Scoring): number[] {
  const out = new Array<number>(banner.length)
  for (let i = 0; i < banner.length; i++) {
    const emblem = banner[i]!
    let m = 1 + (scoring.quality[emblem.tier] ?? 0) + selfBonus(emblem, banner, scoring)
    const before = banner[i - 1]
    const after = banner[i + 1]
    if (before) m += scoring.traits[before.trait]?.adjacentBonus ?? 0
    if (after) m += scoring.traits[after.trait]?.adjacentBonus ?? 0
    out[i] = m
  }
  return out
}

/**
 * An emblem's own trait bonus, after its condition is evaluated.
 *
 * Three of the five are whole-banner conditions that no rearrangement can help,
 * which is why a Fractal showing -10% is Fractal *not firing* plus a Vampiric
 * neighbour charging it, rather than a bug.
 */
function selfBonus(emblem: Emblem, banner: Emblem[], scoring: Scoring): number {
  const spec = scoring.traits[emblem.trait]
  if (!spec) return 0
  switch (emblem.trait) {
    case "fractal": {
      // Fires only if every quality on the banner differs. A banner is three to
      // five emblems, so the pairwise scan beats building a set of tiers.
      for (let i = 0; i < banner.length; i++) {
        for (let j = i + 1; j < banner.length; j++) {
          if (banner[i]!.tier === banner[j]!.tier) return 0
        }
      }
      return spec.bonus
    }
    case "friendly":
      return count(banner, "friendly") >= 3 ? spec.bonus : 0
    case "unique":
      return count(banner, "unique") === 1 ? spec.bonus : 0
    case "benevolent":
      return 0 // pays its neighbours, nothing to itself
    default:
      return spec.bonus
  }
}

function count(banner: Emblem[], trait: string): number {
  let n = 0
  for (let i = 0; i < banner.length; i++) if (banner[i]!.trait === trait) n += 1
  return n
}

/**
 * What one stat pays this player, per game, before any multiplier.
 *
 * A stat the source data never measured is NaN, and it contributes the stat's
 * flat base and nothing else -- the same as the engine. Scoring it as zero would
 * be a measurement claim nobody made. A stat with no `source` column at all is
 * that same case, reached a row earlier.
 */
function statValues(
  samples: DecodedSamples,
  stat: string,
  scoring: Scoring,
  index: RunIndex,
): Float64Array {
  const spec = scoring.stats[stat]
  const perUnit = spec?.perUnit ?? 0
  const base = spec?.base ?? 0
  const source = spec?.source ?? null
  const column = source === null ? undefined : index.statColumn.get(source)

  const nStats = samples.stats.length
  const out = new Float64Array(samples.nGames)
  for (let row = 0; row < samples.nGames; row++) {
    if (column === undefined) {
      out[row] = base
      continue
    }
    const value = samples.games[row * nStats + column]
    out[row] = value === undefined || Number.isNaN(value) ? base : base + perUnit * value
  }
  return out
}

/** The per-game value of each named stat for a slot, on its joint matches. */
export interface SlotStats {
  /** Stat key -> one value per joint match, duo-averaged. */
  values: Map<string, Float64Array>
  startTime: Float64Array
  weight: Float64Array
  /** Joint matches found. Zero means this slot cannot be scored at all. */
  nGames: number
}

/**
 * Each stat's per-match value for a slot: the duo's average IN THE SAME MATCH.
 *
 * Only matches where every member appears are used. Teammates' stat lines are
 * strongly correlated -- a stomp inflates everyone -- so averaging two
 * independently drawn distributions would understate the spread of the pair.
 * Returns the values alongside their match times so the caller can weight them.
 *
 * Averaging the stats and then applying the multipliers is the same arithmetic
 * as scoring each player and averaging the totals, because both members wear
 * the same banner -- and it is the form the banner search needs, since these
 * vectors are exactly what stays fixed while the multipliers move.
 */
export function slotStatValues(
  members: DecodedSamples[],
  stats: string[],
  scoring: Scoring,
  index: RunIndex,
): SlotStats {
  const empty: SlotStats = {
    values: new Map(),
    startTime: new Float64Array(0),
    weight: new Float64Array(0),
    nGames: 0,
  }

  const [first, ...rest] = members
  if (!first) return empty

  const wanted = [...new Set(stats)]
  const perPlayer = members.map(
    (m) => new Map(wanted.map((stat) => [stat, statValues(m, stat, scoring, index)])),
  )

  // The joint rows, resolved once: every stat reads the same matches, so
  // finding them per stat would be the same join done `wanted.length` times.
  const rows: number[][] = []
  const startTime: number[] = []
  const weight: number[] = []
  for (let row = 0; row < first.nGames; row++) {
    const matchId = first.matchId[row]!
    const joint = [row, ...rest.map((m) => m.rowOfMatch.get(matchId) ?? -1)]
    if (joint.some((r) => r < 0)) continue
    rows.push(joint)
    startTime.push(first.startTime[row]!)
    weight.push(first.gameWeight[row]!)
  }
  if (rows.length === 0) return empty

  const values = new Map<string, Float64Array>()
  for (const stat of wanted) {
    const out = new Float64Array(rows.length)
    for (let i = 0; i < rows.length; i++) {
      let sum = 0
      for (let m = 0; m < members.length; m++) sum += perPlayer[m]!.get(stat)![rows[i]![m]!]!
      out[i] = sum / members.length
    }
    values.set(stat, out)
  }

  return {
    values,
    startTime: Float64Array.from(startTime),
    weight: Float64Array.from(weight),
    nGames: rows.length,
  }
}

/**
 * The slot's per-match scores under one banner: sum of stat x multiplier.
 *
 * `out` is optional so a search can reuse one buffer across tens of thousands
 * of candidates rather than allocating a pool apiece.
 */
export function combine(
  slot: SlotStats,
  banner: Emblem[],
  mults: number[],
  out?: Float64Array,
): Float64Array {
  const scores = out ?? new Float64Array(slot.nGames)
  scores.fill(0, 0, slot.nGames)
  for (let i = 0; i < banner.length; i++) {
    const values = slot.values.get(banner[i]!.stat)
    if (!values) continue
    const m = mults[i] ?? 1
    for (let row = 0; row < slot.nGames; row++) scores[row]! += m * values[row]!
  }
  return scores
}

/** Per-match scores for one slot under a fixed banner, with their weights. */
export function slotGameScores(
  members: DecodedSamples[],
  banner: Emblem[],
  scoring: Scoring,
  index: RunIndex,
): { scores: Float64Array; startTime: Float64Array; weight: Float64Array } {
  const slot = slotStatValues(
    members,
    banner.map((e) => e.stat),
    scoring,
    index,
  )
  return {
    scores: combine(slot, banner, multipliers(banner, scoring)),
    startTime: slot.startTime,
    weight: slot.weight,
  }
}
