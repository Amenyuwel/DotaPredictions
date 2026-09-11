import assert from "node:assert/strict"
import { test } from "node:test"

import { combine, multipliers, slotGameScores, slotStatValues } from "../src/scoring/banner.js"
import type { DecodedProjection, DecodedSamples, RunIndex } from "../src/scoring/decode.js"
import { searchBanner } from "../src/scoring/optimize.js"
import { expectedBestSeries } from "../src/scoring/project.js"
import { cdfOf, makeRng } from "../src/scoring/random.js"
import { drawPlan, scorePlan } from "../src/scoring/screen.js"
import type { Emblem, Scoring } from "../src/validate.js"

/**
 * Four traps, each of which produces a plausible number rather than an error.
 *
 * 1. The screen and the full rescoring disagreeing about what a simulated
 *    period is. The search would then RANK banners by one objective and REPORT
 *    another, and every number on screen would still look reasonable.
 * 2. The mirror fold dropping a banner that is not actually its mirror's equal.
 *    Half the search space is discarded on the claim that reversing a banner
 *    cannot change its score; if that were ever false, the discarded half would
 *    simply never be considered.
 * 3. The two directions of the tool scoring one banner differently. `rank` goes
 *    through `slotGameScores` and the search through `combine`; if those drift,
 *    the banner a user optimises to and the banner they then look up would
 *    disagree about what it is worth.
 * 4. The alternatives list filling up with reorderings of one emblem set --
 *    ten rows answering a question nobody asked, which is the same trap the
 *    engine's k-best roster search carries bucket constraints for.
 */

const STATS = ["kills", "gpm", "stuns", "roshan", "wards", "smokes"]

const scoring: Scoring = {
  version: "test",
  verifiedAgainstClient: false,
  colors: ["red", "blue"],
  stats: Object.fromEntries(
    STATS.map((stat, i) => [
      stat,
      {
        perUnit: 10 + i * 7,
        base: 0,
        color: i < 3 ? "red" : "blue",
        measurable: true,
        source: stat,
      },
    ]),
  ),
  quality: { tier_i: 0.1, tier_ii: 0.3, tier_iii: 0.6, tier_iv: 1.0, tier_v: 1.5 },
  traits: {
    fractal: { bonus: 0.6, adjacentBonus: 0, condition: "all qualities differ" },
    benevolent: { bonus: 0, adjacentBonus: 0.2 },
    vampiric: { bonus: 0.5, adjacentBonus: -0.1 },
    unique: { bonus: 0.3, adjacentBonus: 0, condition: "only Unique on the banner" },
    friendly: { bonus: 0.5, adjacentBonus: 0, condition: "at least 3 Friendly" },
  },
}

const emblem = (stat: string, tier: string, trait: string): Emblem => ({
  emblemId: `${stat}:${tier}:${trait}`,
  tournamentId: "t",
  stage: "main",
  stat,
  tier,
  trait,
  displayName: `${stat} ${tier} ${trait}`,
  measurable: true,
})

const index: RunIndex = {
  samplesOf: new Map(),
  projectionOf: new Map(),
  statColumn: new Map(STATS.map((stat, i) => [stat, i])),
}

/** One player's sample matrix, filled from a seeded generator so the numbers
 * are arbitrary but the test is not. */
function samples(playerId: number, nGames: number, seed: number): DecodedSamples {
  const rng = makeRng(seed)
  const games = new Float32Array(nGames * STATS.length)
  for (let i = 0; i < games.length; i++) games[i] = rng() * 20
  const matchId = Float64Array.from({ length: nGames }, (_, i) => 1000 + i)
  const rowOfMatch = new Map<number, number>()
  matchId.forEach((id, row) => rowOfMatch.set(id, row))
  return {
    playerId,
    stats: STATS,
    nGames,
    games,
    matchId,
    heroId: new Int32Array(nGames),
    won: new Uint8Array(nGames),
    durationSeconds: new Int32Array(nGames),
    firstBloodTime: new Int32Array(nGames),
    startTime: Float64Array.from({ length: nGames }, () => 1_750_000_000),
    gameWeight: Float32Array.from({ length: nGames }, () => 1),
    warnings: [],
    rowOfMatch,
  }
}

/** A bracket-shaped projection: a handful of series per simulated period. */
function projection(nShapeSamples: number, maxSeries: number, seed: number): DecodedProjection {
  const rng = makeRng(seed)
  const series = new Int8Array(nShapeSamples * maxSeries)
  const decider = new Uint8Array(nShapeSamples * maxSeries)
  for (let s = 0; s < nShapeSamples; s++) {
    const played = 1 + Math.floor(rng() * maxSeries)
    for (let k = 0; k < played; k++) {
      series[s * maxSeries + k] = rng() < 0.5 ? 2 : 3
      decider[s * maxSeries + k] = rng() < 0.5 ? 1 : 0
    }
  }
  return {
    teamId: 1,
    nShapeSamples,
    maxSeries,
    series,
    decider,
    expectedSeries: 3,
    eliminationRisk: 0.4,
    advanceProb: 0.6,
  }
}

const members = [samples(1, 40, 7), samples(2, 40, 11)]
const proj = projection(400, 4, 13)
const inventory = [
  emblem("kills", "tier_v", "vampiric"),
  emblem("gpm", "tier_iv", "fractal"),
  emblem("stuns", "tier_iii", "benevolent"),
  emblem("roshan", "tier_ii", "unique"),
  emblem("wards", "tier_i", "friendly"),
  emblem("smokes", "tier_iv", "friendly"),
  emblem("kills", "tier_ii", "benevolent"),
]
const slot = slotStatValues(members, inventory.map((e) => e.stat), scoring, index)
const weights = Float64Array.from({ length: slot.nGames }, (_, i) => 1 + (i % 3) * 0.5)

test("a drawn plan scores a pool exactly as the loop that would have drawn it", () => {
  const cdf = cdfOf(weights)
  for (const bonus of [0, 0.16]) {
    const plan = drawPlan(cdf, proj, makeRng(99), 250, bonus)
    for (const banner of [inventory.slice(0, 5), inventory.slice(1, 6), inventory.slice(2, 7)]) {
      const pool = combine(slot, banner, multipliers(banner, scoring))
      const replayed = scorePlan(pool, plan)
      const drawn = expectedBestSeries(pool, cdf, proj, makeRng(99), 250, bonus)
      assert.equal(
        replayed,
        drawn,
        "the screen would rank banners by a different objective than the one reported",
      )
    }
  }
})

test("reversing a banner cannot change what it scores", () => {
  // The search discards half its candidates on exactly this claim.
  for (const banner of [inventory.slice(0, 5), inventory.slice(2, 7)]) {
    const forward = combine(slot, banner, multipliers(banner, scoring))
    const reversed = [...banner].reverse()
    const backward = combine(slot, reversed, multipliers(reversed, scoring))
    for (let i = 0; i < forward.length; i++) {
      assert.ok(
        Math.abs(forward[i]! - backward[i]!) < 1e-9,
        `mirror image differs at game ${i}: ${forward[i]} vs ${backward[i]}`,
      )
    }
  }
})

test("both directions of the tool score one banner identically", () => {
  const banner = inventory.slice(0, 5)
  const direct = slotGameScores(members, banner, scoring, index)
  const searched = combine(
    slotStatValues(members, banner.map((e) => e.stat), scoring, index),
    banner,
    multipliers(banner, scoring),
  )
  assert.equal(direct.scores.length, searched.length)
  for (let i = 0; i < searched.length; i++) {
    assert.ok(
      Math.abs(direct.scores[i]! - searched[i]!) < 1e-9,
      `rank and optimize disagree at game ${i}`,
    )
  }
})

test("the alternatives are other emblem sets, never reorderings of the winner", () => {
  const found = searchBanner(inventory, slot, proj, scoring, weights, {
    slots: 5,
    screenSims: 120,
    keep: 6,
    sims: 400,
    boot: 12,
    seed: 5,
  })
  assert.ok(found.best, "seven emblems in five slots must produce a banner")

  const setOf = (b: { emblems: Emblem[] }) =>
    b.emblems
      .map((e) => e.emblemId)
      .sort()
      .join("|")
  const seen = new Set([setOf(found.best!)])
  for (const alt of found.alternatives) {
    assert.ok(!seen.has(setOf(alt)), "an alternative repeats the winning emblem set")
    seen.add(setOf(alt))
  }

  // The counts are exact, not a lower bound. Seven emblems in five slots is
  // C(7,5) = 21 sets, ten of which use both `kills` emblems and are illegal
  // because a banner may repeat a colour but never a stat, leaving 11. Each is
  // 5! = 120 orders, halved to 60 by the mirror fold.
  assert.equal(found.subsets, 11)
  assert.equal(found.arrangements, 11 * 60)
  assert.ok(
    found.worstOrder === null || found.worstOrder.score <= found.best!.score,
    "the worst order of the winning set cannot beat its best",
  )
  assert.equal(
    setOf(found.worstOrder ?? found.best!),
    setOf(found.best!),
    "the order gap must be quoted against the banner on screen",
  )
})
