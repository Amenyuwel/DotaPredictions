import { Router } from "express"

import { config } from "../config.js"
import { createMemo } from "../memo.js"
import { runStore } from "../run-store.js"
import { overlapping, unmeasurableCaveats } from "../scoring/answer.js"
import { slotStatValues } from "../scoring/banner.js"
import {
  customQualities,
  goalById,
  goalQualities,
  LADDER,
  tierNumeral,
  type Goal,
} from "../scoring/goals.js"
import type { ScoredArrangement } from "../scoring/optimize.js"
import { recencyWeights } from "../scoring/project.js"
import { rerollCost, type RerollCost } from "../scoring/rerolls.js"
import { slotColors } from "../scoring/slots.js"
import { targetSearch } from "../scoring/target.js"
import { indexFor, unitOf, type Unit } from "../scoring/units.js"
import type { FantasyRole, RunPayload } from "../validate.js"

/**
 * POST /api/banner/target
 *
 * The third question, and the one you ask first: what should I be hunting?
 *
 * `/api/player/rank` fixes a banner and ranks units. `/api/banner/optimize`
 * fixes a unit and ranks arrangements of the emblems you already hold. This
 * fixes a unit and ranks the whole catalog -- no inventory, because the point
 * is the goal rather than tonight's best compromise.
 *
 * It answers in the same shape as `/api/banner/optimize` on purpose. The two
 * are the same claim about the same unit at two moments, so the client draws
 * them with one panel and a reader comparing them is comparing like with like.
 *
 * What it is NOT is the ceiling. Quality cannot be rerolled -- the client rolls
 * stats and traits and nothing else -- so a search over the whole catalog names
 * five Tier V emblems every time, which is the best banner that could exist and
 * not one anybody can go and get. That answer is still here, as the `perfect`
 * rung, labelled as what it is. Every other rung fixes the qualities you would
 * have to have CRAFTED and optimises the two halves a token can actually buy.
 * `goals.ts` carries the ladder and the reason it is a ladder of quality
 * multisets rather than of probabilities.
 */
export const targetRouter: Router = Router()

interface TargetBody {
  role?: FantasyRole
  teamId?: number
  /** Which rung of the ladder to answer. Defaults to the realistic one: the
   * ceiling is a thing to know, not the thing to aim at. */
  goal?: string
  /** The hand to score, for `goal: "custom"` only: one quality per slot. */
  qualities?: unknown
  /** Which run to score against. Both narrow; neither is required. */
  tournamentId?: string
  stage?: string
}

const memo = createMemo(200)

targetRouter.post("/banner/target", (req, res) => {
  const body = (req.body ?? {}) as TargetBody
  const payload = runStore.find(body.tournamentId, body.stage)
  if (!payload) {
    res.status(404).json({
      error: "no_current_run",
      reason:
        runStore.state.status === "ready"
          ? `no current run for ${body.tournamentId ?? "any tournament"} / ${body.stage ?? "any stage"}`
          : runStore.state.reason,
      available: runStore.available,
    })
    return
  }

  const role = body.role
  if (role !== "core" && role !== "mid" && role !== "support") {
    res.status(400).json({
      error: "role_required",
      reason:
        "A banner is worn by a slot. core and support are duos and mid is a " +
        "single player, so which players stand behind it depends on which you mean.",
    })
    return
  }

  const teamId = body.teamId
  if (typeof teamId !== "number" || !Number.isFinite(teamId)) {
    res.status(400).json({ error: "team_required", reason: "send the unit's teamId" })
    return
  }

  const goal = goalById(body.goal ?? "realistic")
  if (!goal) {
    res.status(400).json({
      error: "no_such_goal",
      reason: `unknown goal ${String(body.goal)}; the ladder is ${LADDER.map((g) => g.id).join(", ")}`,
    })
    return
  }

  const index = indexFor(payload)
  const unit = unitOf(payload, role, teamId, index)
  if (!unit) {
    // Not a fallback to another team, for the same reason as the other two
    // directions: "this slot cannot be scored" is not "score it anyway".
    res.status(404).json({
      error: "no_such_unit",
      reason: `no scoreable ${role} slot for team ${teamId} in this run`,
    })
    return
  }

  // A custom hand is part of the question, so it is checked here -- where a
  // bad one can still be a 400 -- rather than inside the search, where the only
  // thing left to do with it would be to quietly score something else.
  let rung = goal
  if (goal.id === "custom") {
    const parsed = customQualities(body.qualities, payload.run.bannerSlots, payload.scoring)
    if ("error" in parsed) {
      res.status(400).json({ error: "bad_qualities", reason: parsed.error })
      return
    }
    rung = { ...goal, qualities: parsed.qualities }
  }

  // The whole answer is a function of the run, the unit and the hand -- there
  // is no inventory to vary -- so one roster's three slots are three keys, and
  // a reader switching tabs and back pays for none of them twice.
  const key = memo.key(payload.run.runId, role, teamId, rung.id, rung.qualities.join(","))
  res.json(memo.remember(key, () => target(payload, unit, rung)))
})

/** The ladder as the client draws it, at this period's length. Sent with every
 * answer so the rungs are named in one place -- a client with its own copy of
 * "Ambitious means one Tier V" is a second definition waiting to drift. */
const ladderFor = (slots: number) =>
  LADDER.map((rung) => ({
    id: rung.id,
    label: rung.label,
    qualities: rung.qualities.slice(0, slots),
    asks: rung.asks,
  }))

/** The highest quality this run has, by what it pays. Read rather than named,
 * so a period with six tiers does not leave "Tier V" as the ceiling. */
const TOP_TIER = (scoring: RunPayload["scoring"]) =>
  Object.entries(scoring.quality).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""

const goalShape = (goal: Goal, slots: number) => ({
  id: goal.id,
  label: goal.label,
  qualities: goal.qualities.slice(0, slots),
  asks: goal.asks,
})

/**
 * An answer with no banner in it.
 *
 * Shared by every refusal so they cannot drift into different shapes: the
 * client draws one panel, and a missing `goal` or `rerolls` on one of these
 * rows would be a second contract for the same endpoint. The search counters
 * are zeroed rather than omitted, because "nothing was searched" is a fact
 * about this answer and not an absence of one.
 */
function emptyHead(
  payload: RunPayload,
  unit: Unit,
  slots: number,
  colors: string[],
  goal: Goal,
  rerolls: RerollCost | null,
) {
  return {
    goal: goalShape(goal, slots),
    ladder: ladderFor(slots),
    rerolls,
    runId: payload.run.runId,
    computedAt: new Date().toISOString(),
    unit: {
      unitId: unit.unitId,
      teamId: unit.teamId,
      role: unit.role,
      players: unit.players,
    },
    search: {
      kind: "catalog" as const,
      slots,
      slotColors: colors,
      catalog: payload.emblems.length,
      profiles: 0,
      statsConsidered: 0,
      statsTotal: 0,
      candidates: 0,
      screened: 0,
      arrangements: 0,
      rescored: 0,
      screenSims: config.search.screenSims,
      sims: config.scoring.sims,
      nGames: 0,
    },
    tournamentContext: {
      expectedSeries: unit.projection.expectedSeries,
      advanceProb: unit.projection.advanceProb,
      eliminationRisk: unit.projection.eliminationRisk,
    },
    best: null,
    alternatives: [] as ReturnType<typeof shapeArrangement>[],
    tied: [] as string[],
    worstOrder: null,
  }
}

/** The run predates `scoring.bannerColors`, so which stats a slot can hold is
 * unknown. Answering anyway is what produced Gold Per Min on a Support banner. */
function noColorRow(payload: RunPayload, unit: Unit, slots: number, goal: Goal) {
  return {
    ...emptyHead(payload, unit, slots, [], goal, null),
    reason:
      `This run does not publish which colour each banner slot carries, and that rule ` +
      `decides which stats a slot can hold at all. Republish it with \`publish.py\` - ` +
      `answering without it is how a red stat ended up on a Support banner.`,
    caveats: [] as string[],
  }
}

/** One ranked banner as the wire carries it. Named rather than inlined because
 * `emptyHead` has to say what its empty `alternatives` is a list OF. */
const shapeArrangement = (b: ScoredArrangement) => ({
  bannerId: b.bannerId,
  emblems: b.emblems,
  multipliers: b.multipliers,
  score: b.score,
  ci: b.ci,
})

function target(payload: RunPayload, unit: Unit, goal: Goal) {
  const index = indexFor(payload)
  const slots = payload.run.bannerSlots

  // EVERY stat in the catalog, not a chosen few: which ones belong on the
  // banner is the question, so narrowing here would be answering it.
  const stats = [...new Set(payload.emblems.map((e) => e.stat))]
  const slot = slotStatValues(unit.members, stats, payload.scoring, index)
  const weights = recencyWeights(
    slot.startTime,
    slot.weight,
    payload.run.params.statHalfLife,
    Date.parse(payload.run.params.asOf) / 1000,
  )

  // Keyed the way the search names an emblem it wants to exist. The catalog is
  // the full cross product, so every lookup hits -- but it is a lookup rather
  // than a constructed row, because a fabricated emblem would carry a
  // fabricated `measurable` and the caveats are built off that field.
  const catalog = new Map(
    payload.emblems.map((e) => [[e.stat, e.tier, e.trait].join(":"), e]),
  )

  // Without a colour row there is no legal banner to aim at -- only the old,
  // wrong answer that put red stats on Support. Refused rather than guessed.
  const colors = slotColors(payload.scoring, unit.role, slots)
  if (!colors) return noColorRow(payload, unit, slots, goal)

  // The rung's qualities are the constraint, and quality is the one thing a
  // token cannot buy -- so this is what the banner asks you to have CRAFTED,
  // and everything below it is the search spending rerolls inside that hand.
  const qualities = goalQualities(goal, slots, payload.scoring)

  // What the rerolls to reach it cost, which is a property of the colour row
  // and the period's budget rather than of the rung: the tiers are not on the
  // table, so every rung costs the same tokens and differs only in the crafts
  // it assumes.
  const rerolls = rerollCost(colors, payload.scoring, payload.run.rerollTokens)

  if (!qualities) {
    return {
      ...emptyHead(payload, unit, slots, colors, goal, rerolls),
      reason:
        `The ${goal.label} goal needs emblems at ` +
        `${goal.qualities.slice(0, slots).map(tierNumeral).join(", ")}, and this run does not ` +
        `list all of those tiers. Answering anyway would quietly give you the all-Tier-V ` +
        `banner under a name that promised something easier.`,
      caveats: [],
    }
  }

  const found = targetSearch(catalog, slot, unit.projection, payload.scoring, weights, {
    slotColors: colors,
    qualities,
    // A named rung is a HAND -- five emblems you crafted, arranged however you
    // like -- so the search places them. A typed one is a BANNER: the reader
    // put a tier on a row, and finding it somewhere else is indistinguishable
    // from the edit having been ignored.
    fixedQualityOrder: goal.id === "custom",
    shortlist: config.search.targetShortlist,
    screenSims: config.search.screenSims,
    keep: config.search.keep,
    sims: config.scoring.sims,
    boot: config.scoring.boot,
    seed: config.scoring.seed,
  })

  const head = {
    goal: goalShape(goal, slots),
    ladder: ladderFor(slots),
    rerolls,
    runId: payload.run.runId,
    computedAt: new Date().toISOString(),
    unit: {
      unitId: unit.unitId,
      teamId: unit.teamId,
      role: unit.role,
      players: unit.players,
    },
    search: {
      kind: "catalog" as const,
      slots,
      slotColors: colors,
      catalog: payload.emblems.length,
      profiles: found.profiles,
      statsConsidered: found.statsConsidered,
      statsTotal: stats.length,
      candidates: found.candidates,
      screened: found.screened,
      arrangements: found.arrangements,
      rescored: found.rescored,
      screenSims: config.search.screenSims,
      sims: config.scoring.sims,
      nGames: slot.nGames,
    },
    tournamentContext: {
      expectedSeries: unit.projection.expectedSeries,
      advanceProb: unit.projection.advanceProb,
      eliminationRisk: unit.projection.eliminationRisk,
    },
  }

  if (!found.best) {
    return {
      ...head,
      best: null,
      alternatives: [],
      tied: [],
      worstOrder: null,
      reason:
        slot.nGames === 0
          ? `${unit.players.map((p) => p.nick).join(" & ")} have no match in this run where ` +
            `all of them played, so there is nothing to score a banner against.`
          : `Fewer than ${slots} of this run's stats can be scored for this slot, so no ` +
            `legal banner can be built at all.`,
      caveats: [],
    }
  }

  // Read off the scoring table rather than written as 5^5 x 5^5: a sixth
  // quality or a sixth trait would otherwise make this sentence quietly wrong
  // about the size of the thing the front stands in for.
  const configurations =
    Object.keys(payload.scoring.quality).length ** slots *
    Object.keys(payload.scoring.traits).length ** slots

  const ranked = [found.best, ...found.alternatives]
  return {
    ...head,
    best: shapeArrangement(found.best),
    alternatives: found.alternatives.map(shapeArrangement),
    tied: overlapping(found.best, ranked, (b) => b.bannerId),
    worstOrder: found.worstOrder ? shapeArrangement(found.worstOrder) : null,
    reason: null,
    caveats: [
      ...unmeasurableCaveats(found.best.emblems),
      ...new Set(unit.members.flatMap((m) => m.warnings)),
      // Every caveat here is one clause. They are required output -- a limit
      // that qualifies a number travels with it -- but a paragraph nobody
      // finishes qualifies nothing, so each says its fact and stops. The fixed
      // slot colours used to be listed here too; they are a rule, not a limit,
      // and the banner drawn above already shows them.
      // The rung itself, stated with the mechanic that makes it a rung. Quality
      // is the half of a banner no token can buy, so a reader has to be told
      // what this answer assumes they already own.
      qualities.every((tier) => tier === TOP_TIER(payload.scoring))
        ? `All Tier V: a benchmark, not a target. Tiers can't be rerolled.`
        : `Assumes tiers ${qualities.map(tierNumeral).join(" ")}. Tiers can't be rerolled.`,
      ...(rerolls
        ? [
            // Rolling is random, so "how many tokens" is the part people get
            // wrong. Said as a count they can compare to what they hold.
            `About ${rerolls.expected} rerolls to build` +
              (rerolls.tokens === null
                ? ` (this stage's token count isn't recorded).`
                : `; alone, fits the roster's ${rerolls.tokens} tokens ` +
                  `${(rerolls.withinBudget! * 100).toFixed(0)}% of the time.`),
          ]
        : []),
      ...(found.statsDropped.length > 0
        ? [
            `${found.statsDropped.join(", ")} left out of the search: can score negative.`,
          ]
        : []),
    ],
  }
}
