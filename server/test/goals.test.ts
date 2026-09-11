import assert from "node:assert/strict"
import { test } from "node:test"

import { customQualities, goalById, goalQualities, LADDER } from "../src/scoring/goals.js"
import { rerollCost } from "../src/scoring/rerolls.js"
import type { Scoring } from "../src/validate.js"

/**
 * What the ladder and the token budget have to get right, both of which fail
 * silently if they get it wrong.
 *
 * A rung whose qualities this run does not carry must REFUSE rather than fall
 * back, because the fallback is the whole catalog -- five Tier V emblems under
 * the name of a goal that asked for less. And a budget that is unknown must
 * stay unknown: reporting "fits" against a number nobody transcribed is exactly
 * the confident wrong answer this project is built to avoid.
 */

const SLOT_COLORS = ["red", "green", "red", "green", "red"]

const scoring: Scoring = {
  version: "test",
  verifiedAgainstClient: false,
  colors: ["red", "green"],
  bannerColors: { core: SLOT_COLORS, mid: SLOT_COLORS, support: SLOT_COLORS },
  // Six stats per colour, which is what TI 2026 ships and what makes the pools
  // below the real ones: a red Core slot can land on three stats, not six.
  stats: Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      `stat_${i}`,
      {
        perUnit: 10,
        base: 0,
        color: i < 6 ? "red" : "green",
        measurable: true,
        source: `stat_${i}`,
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

test("only the perfect rung is all Tier V", () => {
  for (const rung of LADDER) {
    const tiers = rung.qualities
    // Custom carries no hand of its own: the reader's arrives with the request
    // and is checked by `customQualities` instead.
    if (rung.id === "custom") {
      assert.equal(tiers.length, 0)
      continue
    }
    assert.equal(tiers.length, 5)
    if (rung.id === "perfect") {
      assert.ok(tiers.every((t) => t === "tier_v"))
      continue
    }
    assert.ok(
      !tiers.every((t) => t === "tier_v"),
      `${rung.id} must not be the ceiling under another name`,
    )
  }
  // Tier V is the rare end, so it appears more often the further up you go and
  // never appears at all on the rung labelled realistic.
  const fives = (id: string) =>
    goalById(id)!.qualities.filter((t) => t === "tier_v").length
  assert.equal(fives("realistic"), 0)
  assert.ok(fives("realistic") < fives("ambitious"))
  assert.ok(fives("ambitious") < fives("extreme"))
  assert.ok(fives("extreme") < fives("perfect"))
})

test("a typed hand is checked before anything is scored", () => {
  // Both halves matter. A short hand would score a banner that cannot be worn,
  // and a tier this run has never heard of would fall through the search and
  // come back as the all-Tier-V ceiling under the word "Custom".
  const ok = customQualities(["tier_i", "tier_ii", "tier_iii", "tier_iv", "tier_v"], 5, scoring)
  assert.deepEqual(ok, {
    qualities: ["tier_i", "tier_ii", "tier_iii", "tier_iv", "tier_v"],
  })

  for (const bad of [
    ["tier_v"],
    ["tier_v", "tier_v", "tier_v", "tier_v"],
    ["tier_v", "tier_v", "tier_v", "tier_v", "tier_vi"],
    ["tier_v", "tier_v", "tier_v", "tier_v", 5],
    "tier_v",
    undefined,
  ]) {
    assert.ok(
      "error" in customQualities(bad, 5, scoring),
      `${JSON.stringify(bad)} must be refused, not scored as something else`,
    )
  }
})

test("a rung naming a quality the run does not have refuses", () => {
  const fourTiers: Scoring = {
    ...scoring,
    quality: { tier_i: 0.1, tier_ii: 0.3, tier_iii: 0.6, tier_iv: 1.0 },
  }
  assert.equal(goalQualities(goalById("perfect")!, 5, fourTiers), null)
  assert.deepEqual(goalQualities(goalById("realistic")!, 5, fourTiers), [
    "tier_ii",
    "tier_iii",
    "tier_iii",
    "tier_iv",
    "tier_iv",
  ])
})

test("reroll pools are what the no-duplicate rule leaves, not the colour's size", () => {
  const cost = rerollCost(SLOT_COLORS, scoring, 40)
  assert.ok(cost)
  // Three red slots out of six red stats: a red reroll can land on three stats,
  // because the banner is already wearing the other three.
  assert.deepEqual(cost.statPools, [3, 4, 3, 4, 3])
  assert.equal(cost.traitPool, 4)
  // 17 stat rolls plus five traits at four each. Close enough to 40 that the
  // budget is a real constraint for ONE slot's banner, which is the finding.
  assert.equal(cost.expected, 37)
  assert.ok(cost.withinBudget! > 0 && cost.withinBudget! < 1)
})

test("an unknown budget stays unknown rather than becoming 'it fits'", () => {
  const cost = rerollCost(SLOT_COLORS, scoring, null)
  assert.ok(cost)
  assert.equal(cost.tokens, null)
  assert.equal(cost.withinBudget, null)
  // The expectation does not depend on the budget, so it is still answerable.
  assert.equal(cost.expected, 37)
})

test("a bigger budget is never less likely to cover the banner", () => {
  let previous = 0
  for (const tokens of [10, 20, 30, 40, 60, 120]) {
    const cost = rerollCost(SLOT_COLORS, scoring, tokens)!
    assert.ok(cost.withinBudget! >= previous, `budget ${tokens} went backwards`)
    previous = cost.withinBudget!
  }
  // With ten tokens and ten rolls that each need at least one, only the run
  // where every single roll hits first time fits.
  assert.ok(rerollCost(SLOT_COLORS, scoring, 10)!.withinBudget! < 1e-3)
  assert.ok(previous > 0.9)
})
