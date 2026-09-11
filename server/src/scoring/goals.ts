import type { Scoring } from "../validate.js"

/**
 * What a goal IS, given that quality cannot be rerolled.
 *
 * The client rerolls two things and neither of them is the tier. A stat reroll
 * lands on a stat that is new and not already on the banner; a trait reroll
 * lands on a different trait. Quality is fixed when the emblem is crafted, and
 * the client says only that "qualities with a larger boost are more rare".
 *
 * That single fact is what was wrong with the old answer. The search ran over
 * the whole catalog, so every banner it named was five Tier V emblems -- the
 * arrangement nobody can roll their way into, presented as the thing to aim
 * for. It is the MAXIMUM POSSIBLE OUTCOME, which is a real and useful number,
 * but it is not a goal.
 *
 * So a goal is a quality multiset -- what you must have crafted -- and the
 * search optimises the two halves you CAN reroll inside it. The ladder below is
 * four of those multisets. It is deliberately not a probability: no crafting
 * odds are published anywhere, and a rung that said "62% achievable" would be
 * quoting a number nobody has. Each rung instead says exactly what it asks for,
 * which a reader can check against their own inventory.
 *
 * One consequence falls out of the rules rather than out of taste: Fractal pays
 * +60% only when every quality on the banner differs, so a mixed banner is not
 * simply a worse perfect one. Whether the mixture beats the uniform high roll
 * is a question for the search, and the ladder exists so the search can be
 * asked it.
 */
export type GoalId = "realistic" | "ambitious" | "extreme" | "perfect" | "custom"

export interface Goal {
  id: GoalId
  label: string
  /** Qualities this goal asks for, worst-first, at Main Event length. A shorter
   * period takes the FIRST `slots` of the row -- the same carry-over rule the
   * colour row uses, because the group stage's three emblems are the three that
   * carry into the Main Event. */
  qualities: string[]
  /** What the rung asks of the reader, in one sentence. */
  asks: string
}

/**
 * The ladder, worst rung first.
 *
 * Tier keys are the config's own (`tier_i` ... `tier_v`), so a period that
 * renames or re-numbers its qualities breaks loudly here rather than scoring a
 * banner whose tiers no longer exist.
 */
export const LADDER: Goal[] = [
  {
    id: "realistic",
    label: "Realistic",
    qualities: ["tier_ii", "tier_iii", "tier_iii", "tier_iv", "tier_iv"],
    asks: "no Tier V - the mix you usually end up with",
  },
  {
    id: "ambitious",
    label: "Ambitious",
    qualities: ["tier_iii", "tier_iii", "tier_iv", "tier_iv", "tier_v"],
    asks: "one Tier V, nothing below Tier III",
  },
  {
    id: "extreme",
    label: "Extreme",
    qualities: ["tier_iii", "tier_iv", "tier_v", "tier_v", "tier_v"],
    asks: "three Tier V emblems on one banner",
  },
  {
    id: "perfect",
    label: "Perfect",
    qualities: ["tier_v", "tier_v", "tier_v", "tier_v", "tier_v"],
    asks: "every emblem Tier V - the best that could exist, not something to plan for",
  },
  {
    // The rungs above are four hands worth naming; this is the reader's own.
    // Its `qualities` are empty here because they arrive with the request --
    // the ladder entry exists so the tab has somewhere to come from, and the
    // answer echoes back the hand it actually scored.
    id: "custom",
    label: "Custom",
    qualities: [],
    asks: "the emblems you actually have - set each tier yourself",
  },
]

export const goalById = (id: string): Goal | undefined =>
  LADDER.find((goal) => goal.id === id)

/** "tier_iii" -> "III". The config key is how the run stores a quality; it is
 * not how anyone says it out loud, and a sentence full of `tier_ii` reads as a
 * dump of internals rather than as an answer. */
export const tierNumeral = (tier: string) => tier.replace(/^tier_/, "").toUpperCase()

/**
 * The qualities a goal asks for at this period's length, or null if the run's
 * scoring table does not carry one of them.
 *
 * Null rather than a substitution. Dropping an unknown tier would quietly
 * answer a different question -- "the best four-tier banner" under a name that
 * promised five -- and silently scoring a goal nobody asked for is the failure
 * this whole direction exists to stop.
 */
export function goalQualities(goal: Goal, slots: number, scoring: Scoring): string[] | null {
  const row = goal.qualities.slice(0, slots)
  if (row.length < slots) return null
  return row.every((tier) => tier in scoring.quality) ? row : null
}

/**
 * A hand the reader typed, checked before anything is scored.
 *
 * Length and membership both, and neither is pedantry: four tiers in a
 * five-slot period would score a banner that cannot be worn, and a tier this
 * run has never heard of would fall through the search and come back as the
 * all-Tier-V ceiling under the word "Custom".
 */
export function customQualities(
  raw: unknown,
  slots: number,
  scoring: Scoring,
): { qualities: string[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length !== slots) {
    return {
      error: `a custom goal needs one quality per slot: ${slots} of them, worst to best`,
    }
  }
  const qualities: string[] = []
  for (const tier of raw) {
    if (typeof tier !== "string" || !(tier in scoring.quality)) {
      return {
        error: `${String(tier)} is not a quality in this run; they are ${Object.keys(
          scoring.quality,
        ).join(", ")}`,
      }
    }
    qualities.push(tier)
  }
  return { qualities }
}
