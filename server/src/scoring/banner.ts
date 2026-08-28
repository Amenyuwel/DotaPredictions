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
 */

/** Multiplier per emblem, in banner order: 1 + quality + own trait + neighbours. */
export function multipliers(banner: Emblem[], scoring: Scoring): number[] {
  return banner.map((e, i) => {
    let m = 1 + (scoring.quality[e.tier] ?? 0) + selfBonus(e, banner, scoring)
    for (const j of [i - 1, i + 1]) {
      const neighbour = banner[j]
      if (neighbour) m += scoring.traits[neighbour.trait]?.adjacentBonus ?? 0
    }
    return m
  })
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
      const tiers = banner.map((e) => e.tier)
      return new Set(tiers).size === tiers.length ? spec.bonus : 0
    }
    case "friendly":
      return banner.filter((e) => e.trait === "friendly").length >= 3 ? spec.bonus : 0
    case "unique":
      return banner.filter((e) => e.trait === "unique").length === 1 ? spec.bonus : 0
    case "benevolent":
      return 0 // pays its neighbours, nothing to itself
    default:
      return spec.bonus
  }
}

/**
 * Per-game scores for one player under a fixed banner.
 *
 * A stat the source data never measured is NaN, and it contributes the stat's
 * flat base and nothing else -- the same as the engine. Scoring it as zero would
 * be a measurement claim nobody made.
 */
export function playerGameScores(
  samples: DecodedSamples,
  banner: Emblem[],
  mults: number[],
  scoring: Scoring,
  index: RunIndex,
): Float64Array {
  const nStats = samples.stats.length
  const out = new Float64Array(samples.nGames)

  const terms = banner.map((emblem, i) => {
    const stat = scoring.stats[emblem.stat]
    const source = stat?.source ?? null
    const column = source === null ? undefined : index.statColumn.get(source)
    return {
      perUnit: stat?.perUnit ?? 0,
      base: stat?.base ?? 0,
      multiplier: mults[i] ?? 1,
      column,
    }
  })

  for (let row = 0; row < samples.nGames; row++) {
    let total = 0
    for (const t of terms) {
      if (t.column === undefined) {
        total += t.base * t.multiplier
        continue
      }
      const value = samples.games[row * nStats + t.column]
      total +=
        value === undefined || Number.isNaN(value)
          ? t.base * t.multiplier
          : (t.base + t.perUnit * value) * t.multiplier
    }
    out[row] = total
  }
  return out
}

/**
 * The slot's per-match scores: the duo's average IN THE SAME MATCH.
 *
 * Only matches where every member appears are used. Teammates' stat lines are
 * strongly correlated -- a stomp inflates everyone -- so averaging two
 * independently drawn distributions would understate the spread of the pair.
 * Returns the scores alongside their match ids so the caller can weight them.
 */
export function slotGameScores(
  members: DecodedSamples[],
  banner: Emblem[],
  scoring: Scoring,
  index: RunIndex,
): { scores: Float64Array; startTime: Float64Array; weight: Float64Array } {
  const mults = multipliers(banner, scoring)
  const perPlayer = members.map((m) => playerGameScores(m, banner, mults, scoring, index))

  const [first, ...rest] = members
  if (!first) return { scores: new Float64Array(0), startTime: new Float64Array(0), weight: new Float64Array(0) }

  const scores: number[] = []
  const startTime: number[] = []
  const weight: number[] = []

  for (let row = 0; row < first.nGames; row++) {
    const matchId = first.matchId[row]!
    const rows = [row, ...rest.map((m) => m.rowOfMatch.get(matchId) ?? -1)]
    if (rows.some((r) => r < 0)) continue // not a joint game

    let sum = 0
    for (let i = 0; i < members.length; i++) sum += perPlayer[i]![rows[i]!]!
    scores.push(sum / members.length)
    startTime.push(first.startTime[row]!)
    weight.push(first.gameWeight[row]!)
  }

  return {
    scores: Float64Array.from(scores),
    startTime: Float64Array.from(startTime),
    weight: Float64Array.from(weight),
  }
}
