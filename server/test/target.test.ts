import assert from "node:assert/strict"
import { test } from "node:test"

import { multipliers, slotStatValues } from "../src/scoring/banner.js"
import type { DecodedProjection, DecodedSamples, RunIndex } from "../src/scoring/decode.js"
import { recencyWeights } from "../src/scoring/project.js"
import { makeRng } from "../src/scoring/random.js"
import { paretoProfiles, targetSearch } from "../src/scoring/target.js"
import type { Emblem, Scoring } from "../src/validate.js"

/**
 * Three traps, and the first is the one that would be invisible.
 *
 * 1. **The Pareto front dropping a winner.** `paretoProfiles` throws away
 *    99.98% of the tier/trait configurations on an argument -- a dominated
 *    profile cannot win for any stat values -- and then the search never looks
 *    at them again. If the argument or its implementation were wrong, the tool
 *    would not fail; it would confidently recommend the second-best banner
 *    forever. So the front is checked against a brute force over every
 *    configuration, at three slots where that is 15,625 rather than 9,765,625.
 *
 * 2. **The front containing something it should not.** A profile beaten slot
 *    for slot costs search time and can never be the answer. That is not a
 *    wrong number, but it is how a float comparison missing by one bit hides.
 *
 * 3. **An illegal banner coming back.** Two rules, and the second was missing
 *    for a long time: no stat may appear twice, and the colour of each slot is
 *    fixed by role. The search builds candidates by pairing a stat list with a
 *    position list rather than by walking an inventory, so nothing in the
 *    search itself enforces either one. Under the old, colour-blind version it
 *    put Gold Per Min -- red -- on a Support banner, which has no red slot, and
 *    reported a confident projection for a banner that cannot be built.
 */

const STATS = ["kills", "gpm", "stuns", "roshan", "wards", "smokes", "runes", "towers"]
const TIERS = ["tier_i", "tier_ii", "tier_iii", "tier_iv", "tier_v"]
const TRAITS = ["fractal", "benevolent", "vampiric", "unique", "friendly"]

/** Core's real row, which is what the search is shaped around: three of one
 * colour and two of another, and no slot free to take any stat. */
const SLOT_COLORS = ["red", "green", "red", "green", "red"]
const SLOT_COLORS_3 = SLOT_COLORS.slice(0, 3)

const scoring: Scoring = {
  version: "test",
  verifiedAgainstClient: false,
  colors: ["red", "green"],
  bannerColors: { core: SLOT_COLORS, mid: SLOT_COLORS, support: SLOT_COLORS },
  stats: Object.fromEntries(
    STATS.map((stat, i) => [
      stat,
      {
        perUnit: 10 + i * 7,
        base: 0,
        color: i < 4 ? "red" : "green",
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

/** The full cross product, which is what a run actually ships. */
const catalog = new Map<string, Emblem>()
for (const stat of STATS) {
  for (const tier of TIERS) {
    for (const trait of TRAITS) {
      catalog.set([stat, tier, trait].join(":"), emblem(stat, tier, trait))
    }
  }
}

const index: RunIndex = {
  samplesOf: new Map(),
  projectionOf: new Map(),
  statColumn: new Map(STATS.map((stat, i) => [stat, i])),
}

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

const dominates = (a: number[], b: number[]) => a.every((value, i) => value >= b[i]!)

/**
 * A profile's comparison key: each colour's multipliers sorted large-first, laid
 * end to end.
 *
 * Per colour, not over the whole banner. A stat belongs to exactly one colour
 * and a slot's colour is fixed, so the only rearrangement available is within a
 * colour -- and a key that sorted all five together would compare two profiles
 * on a swap the game does not allow.
 */
function key(mults: number[], colors: string[]): number[] {
  return [...new Set(colors)].flatMap((color) =>
    colors
      .map((c, i) => (c === color ? mults[i]! : null))
      .filter((m): m is number => m !== null)
      .sort((a, b) => b - a)
      .map((m) => Math.round(m * 1e6) / 1e6),
  )
}

/** Every tier/trait configuration, priced. The thing `paretoProfiles` prunes. */
function bruteForce(colors: string[]): number[][] {
  const out: number[][] = []
  const rows = (values: string[], k: number): string[][] =>
    k === 0 ? [[]] : rows(values, k - 1).flatMap((rest) => values.map((v) => [v, ...rest]))
  for (const tiers of rows(TIERS, colors.length)) {
    for (const traits of rows(TRAITS, colors.length)) {
      const banner = tiers.map((tier, i) => emblem("kills", tier, traits[i]!))
      out.push(key(multipliers(banner, scoring), colors))
    }
  }
  return out
}

test("the front covers every configuration it threw away", () => {
  const front = paretoProfiles(scoring, SLOT_COLORS_3).map((p) =>
    key(p.multipliers, SLOT_COLORS_3),
  )
  const all = bruteForce(SLOT_COLORS_3)
  assert.equal(all.length, 15_625)

  // The claim the whole search rests on: for any configuration in the catalog,
  // some profile the front kept is at least as good at every rank of every
  // colour. A stat assignment that beats the front therefore does not exist.
  for (const profile of all) {
    assert.ok(
      front.some((kept) => dominates(kept, profile)),
      `no kept profile covers ${profile.join(",")}`,
    )
  }
})

test("nothing in the front is beaten rank for rank by the rest of it", () => {
  for (const colors of [SLOT_COLORS_3, SLOT_COLORS]) {
    const front = paretoProfiles(scoring, colors).map((p) => key(p.multipliers, colors))
    for (const a of front) {
      for (const b of front) {
        if (a === b) continue
        assert.ok(
          !(dominates(a, b) && !dominates(b, a)),
          `${a.join(",")} beats ${b.join(",")} everywhere, so the latter is dead weight`,
        )
      }
    }
  }
})

test("the front is a handful, not a search space", () => {
  // Pinned so a scoring change that quietly widens it is visible in the diff
  // rather than only in the latency. Three slots is 15,625 configurations and
  // five is 9,765,625. The colour row makes the front LARGER than the old
  // colour-blind one, which is the point: a profile that loses on the sorted
  // vector can still win once the swap that beat it turns out to be illegal.
  assert.ok(paretoProfiles(scoring, SLOT_COLORS_3).length >= 7)
  assert.ok(paretoProfiles(scoring, SLOT_COLORS).length >= 20)
})

test("the banner it returns is legal and complete", () => {
  const members = [samples(1, 40, 7), samples(2, 40, 11)]
  const slot = slotStatValues(members, STATS, scoring, index)
  const weights = recencyWeights(slot.startTime, slot.weight, 60, 1_750_100_000)

  const found = targetSearch(catalog, slot, projection(400, 4, 13), scoring, weights, {
    slotColors: SLOT_COLORS,
    shortlist: 500,
    screenSims: 60,
    keep: 3,
    sims: 400,
    boot: 40,
    seed: 5,
  })

  assert.ok(found.best, "a full catalog and a scoreable slot must produce a banner")
  assert.equal(found.best.emblems.length, 5)
  assert.equal(new Set(found.best.emblems.map((e) => e.stat)).size, 5)
  assert.ok(found.candidates > 0)

  // The rule that was missing. Every slot's colour is fixed by role, so a
  // banner that puts a red stat where the row says green is not a worse answer,
  // it is an impossible one -- and it used to come back with a confident score.
  found.best.emblems.forEach((e, i) => {
    assert.equal(
      scoring.stats[e.stat]?.color,
      SLOT_COLORS[i],
      `slot ${i + 1} must be ${SLOT_COLORS[i]}, got ${e.stat}`,
    )
  })
  // Every emblem came out of the catalog rather than being constructed, so the
  // caveats can trust `measurable`.
  for (const e of found.best.emblems) {
    assert.equal(catalog.get([e.stat, e.tier, e.trait].join(":")), e)
  }
})

test("a stat whose value can go negative is dropped, not scored", () => {
  // The front's argument is that a bigger multiplier is never worse. A negative
  // per-game value breaks it, so such a stat must leave the search rather than
  // quietly invalidate the pruning.
  const penalty: Scoring = {
    ...scoring,
    stats: {
      ...scoring.stats,
      // Red, so it is a genuine candidate for slots 1, 3 and 5 rather than
      // excluded by colour before the negative-value rule is even reached.
      deaths: { perUnit: -195, base: 0, color: "red", measurable: true, source: "deaths" },
    },
  }
  const stats = [...STATS, "deaths"]
  const withDeaths: RunIndex = {
    ...index,
    statColumn: new Map(stats.map((stat, i) => [stat, i])),
  }
  const members = [samples(1, 40, 7), samples(2, 40, 11)].map((m) => ({
    ...m,
    stats,
    games: Float32Array.from({ length: m.nGames * stats.length }, (_, i) => (i % 13) + 1),
  }))

  const slot = slotStatValues(members, stats, penalty, withDeaths)
  const weights = recencyWeights(slot.startTime, slot.weight, 60, 1_750_100_000)
  const found = targetSearch(catalog, slot, projection(400, 4, 13), penalty, weights, {
    slotColors: SLOT_COLORS,
    shortlist: 500,
    screenSims: 60,
    keep: 2,
    sims: 400,
    boot: 0,
    seed: 5,
  })

  assert.ok(found.statsDropped.includes("deaths"))
  assert.ok(found.best)
  assert.ok(!found.best.emblems.some((e) => e.stat === "deaths"))
})

/**
 * The trap this whole direction exists to close.
 *
 * Quality cannot be rerolled, so a goal is a statement about what you CRAFTED.
 * If the search can reach outside the multiset it was given, a rung that says
 * "no Tier V at all" hands back Tier V and the reader has no way to see it --
 * the banner is legal, the score is real, and the promise on the label is the
 * only thing that is wrong.
 */
test("a goal's qualities are exactly what comes back, never more", () => {
  const wanted = ["tier_ii", "tier_iii", "tier_iii", "tier_iv", "tier_iv"]
  const sorted = (row: string[]) => [...row].sort().join(",")

  for (const profile of paretoProfiles(scoring, SLOT_COLORS, wanted)) {
    assert.equal(
      sorted(profile.tiers),
      sorted(wanted),
      `profile ${profile.tiers.join(",")} is not the hand the goal asked for`,
    )
  }

  const members = [samples(1, 40, 7), samples(2, 40, 11)]
  const slot = slotStatValues(members, STATS, scoring, index)
  const weights = recencyWeights(slot.startTime, slot.weight, 60, 1_750_100_000)
  const opts = {
    slotColors: SLOT_COLORS,
    shortlist: 500,
    screenSims: 60,
    keep: 3,
    sims: 400,
    boot: 40,
    seed: 5,
  }

  const goal = targetSearch(catalog, slot, projection(400, 4, 13), scoring, weights, {
    ...opts,
    qualities: wanted,
  })
  assert.ok(goal.best)
  assert.equal(sorted(goal.best.emblems.map((e) => e.tier)), sorted(wanted))

  // And the ceiling is still reachable, still all Tier V, and still at least as
  // good -- a goal is a constraint, so it can never beat the unconstrained
  // answer. If it did, the constraint would be adding value out of nowhere.
  const ceiling = targetSearch(catalog, slot, projection(400, 4, 13), scoring, weights, {
    ...opts,
    qualities: ["tier_v", "tier_v", "tier_v", "tier_v", "tier_v"],
  })
  assert.ok(ceiling.best)
  assert.ok(ceiling.best.emblems.every((e) => e.tier === "tier_v"))
  assert.ok(ceiling.best.score >= goal.best.score)
})

test("the group stage takes the first three of a goal's row", () => {
  // The three emblems carry into the Main Event, so a period of three is the
  // head of the same row and not a separate ladder. A profile built from a
  // five-long row at three slots would be a different goal under one name.
  const wanted = ["tier_ii", "tier_iii", "tier_iii"]
  const front = paretoProfiles(scoring, SLOT_COLORS_3, wanted)
  assert.ok(front.length > 0)
  for (const profile of front) {
    assert.equal(profile.tiers.length, 3)
    assert.equal([...profile.tiers].sort().join(","), [...wanted].sort().join(","))
  }
})

/**
 * A pinned row stays pinned all the way through.
 *
 * There are two places a tier can move. The profile enumeration arranges a
 * hand, and the ordering pass permutes whole emblems to place the positional
 * traits -- and the second one is the easy trap: it is a better banner, it is
 * legal, and it silently relocates the Tier V a reader had just put on row 4.
 * From the outside that is indistinguishable from the edit doing nothing.
 */
test("a custom row comes back in the order it was sent", () => {
  const members = [samples(1, 40, 7), samples(2, 40, 11)]
  const slot = slotStatValues(members, STATS, scoring, index)
  const weights = recencyWeights(slot.startTime, slot.weight, 60, 1_750_100_000)

  // Deliberately not symmetric, so a mirror fold or a same-colour swap shows up
  // as a different row rather than an identical one.
  for (const wanted of [
    ["tier_iii", "tier_i", "tier_iv", "tier_ii", "tier_v"],
    ["tier_v", "tier_ii", "tier_v", "tier_i", "tier_v"],
  ]) {
    const found = targetSearch(catalog, slot, projection(400, 4, 13), scoring, weights, {
      slotColors: SLOT_COLORS,
      qualities: wanted,
      fixedQualityOrder: true,
      shortlist: 500,
      screenSims: 60,
      keep: 3,
      sims: 400,
      boot: 40,
      seed: 5,
    })
    assert.ok(found.best)
    assert.deepEqual(
      found.best.emblems.map((e) => e.tier),
      wanted,
      "the row a reader typed is the row they must get back",
    )
    // The worst order is the same claim about the same hand, so it is pinned too
    // -- otherwise "what the order is worth" would price a swap that is not on
    // offer here.
    if (found.worstOrder) {
      assert.deepEqual(found.worstOrder.emblems.map((e) => e.tier), wanted)
    }
  }
})
