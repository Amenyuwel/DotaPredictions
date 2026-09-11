import { Router } from "express"

import { config } from "../config.js"
import { createMemo } from "../memo.js"
import { runStore } from "../run-store.js"
import { overlapping, unmeasurableCaveats } from "../scoring/answer.js"
import { slotStatValues } from "../scoring/banner.js"
import { searchBanner, type ScoredArrangement } from "../scoring/optimize.js"
import { recencyWeights } from "../scoring/project.js"
import { slotColors } from "../scoring/slots.js"
import { indexFor, unitOf, type Unit } from "../scoring/units.js"
import type { Emblem, FantasyRole, RunPayload } from "../validate.js"

/**
 * POST /api/banner/optimize
 *
 * The mirror of `/api/player/rank`: the unit is fixed and the banner is the
 * free choice. It answers over the emblems you OWN rather than over the
 * catalog, because the catalog is not a choice anybody has -- a five-slot
 * banner drawn from 450 generatable emblems is about 10^13 ordered
 * arrangements, and an exhaustive answer over an inventory is worth more than a
 * heuristic's guess over everything.
 */
export const optimizeRouter: Router = Router()

interface OptimizeBody {
  role?: FantasyRole
  teamId?: number
  /** The emblems you rolled. Order is not an input here -- it is the answer. */
  inventory?: { emblemId?: string }[]
  /** Which run to score against. Both narrow; neither is required. */
  tournamentId?: string
  stage?: string
}

const memo = createMemo(200)

optimizeRouter.post("/banner/optimize", (req, res) => {
  const body = (req.body ?? {}) as OptimizeBody
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

  const index = indexFor(payload)
  const unit = unitOf(payload, role, teamId, index)
  if (!unit) {
    // Not a fallback to another team. A team can be absent because it was
    // eliminated before this stage, or because a member has no sample matrix --
    // both are "this slot cannot be scored", and neither is "score it anyway".
    res.status(404).json({
      error: "no_such_unit",
      reason: `no scoreable ${role} slot for team ${teamId} in this run`,
    })
    return
  }

  const catalog = new Map(payload.emblems.map((e) => [e.emblemId, e]))
  const inventory: Emblem[] = []
  const seen = new Set<string>()
  for (const entry of body.inventory ?? []) {
    const emblem = entry.emblemId ? catalog.get(entry.emblemId) : undefined
    if (!emblem) {
      res.status(400).json({ error: "unknown_emblem", reason: `no emblem ${entry.emblemId}` })
      return
    }
    // Owning the same emblem twice is possible and useless: a banner may repeat
    // a colour but never a stat, so the second copy can never be placed beside
    // the first. Folded rather than rejected -- it is a redundant input, not a
    // wrong one.
    if (seen.has(emblem.emblemId)) continue
    seen.add(emblem.emblemId)
    inventory.push(emblem)
  }

  const slots = payload.run.bannerSlots
  if (inventory.length < slots) {
    res.status(400).json({
      error: "inventory_too_small",
      reason: `a banner in this stage is ${slots} emblems; you sent ${inventory.length}`,
    })
    return
  }
  if (inventory.length > config.search.maxInventory) {
    res.status(400).json({
      error: "inventory_too_large",
      reason:
        `${inventory.length} emblems in ${slots} slots is more arrangements than one ` +
        `request can score exhaustively. The limit is ${config.search.maxInventory}.`,
    })
    return
  }

  const key = memo.key(
    payload.run.runId,
    role,
    teamId,
    [...inventory.map((e) => e.emblemId)].sort().join("|"),
  )
  res.json(memo.remember(key, () => optimize(payload, unit, inventory)))
})

function optimize(
  payload: RunPayload,
  unit: Unit,
  inventory: Emblem[],
) {
  const index = indexFor(payload)
  const slots = payload.run.bannerSlots

  // Every stat in the inventory, valued once. What a stat pays in a game does
  // not depend on which banner it lands on, so this is the half of the
  // arithmetic the search never repeats.
  const slot = slotStatValues(
    unit.members,
    inventory.map((e) => e.stat),
    payload.scoring,
    index,
  )
  const weights = recencyWeights(
    slot.startTime,
    slot.weight,
    payload.run.params.statHalfLife,
    Date.parse(payload.run.params.asOf) / 1000,
  )

  const colors = slotColors(payload.scoring, unit.role, slots)
  const found = searchBanner(inventory, slot, unit.projection, payload.scoring, weights, {
    slots,
    slotColors: colors,
    screenSims: config.search.screenSims,
    keep: config.search.keep,
    sims: config.scoring.sims,
    boot: config.scoring.boot,
    seed: config.scoring.seed,
  })

  const shape = (b: ScoredArrangement) => ({
    bannerId: b.bannerId,
    emblems: b.emblems,
    multipliers: b.multipliers,
    score: b.score,
    ci: b.ci,
  })

  const head = {
    runId: payload.run.runId,
    computedAt: new Date().toISOString(),
    unit: {
      unitId: unit.unitId,
      teamId: unit.teamId,
      role: unit.role,
      players: unit.players,
    },
    search: {
      // Named, because the client draws this answer and the target answer with
      // one panel and the two searched different things.
      kind: "inventory" as const,
      inventory: inventory.length,
      slots,
      arrangements: found.arrangements,
      subsets: found.subsets,
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
          : colors
            ? `No legal banner can be built from these ${inventory.length} emblems. A ` +
              `${unit.role} banner is ${colors.join(" ")}, top to bottom, and no stat may ` +
              `appear twice - so the inventory has to carry the right colours in the ` +
              `right numbers, not just enough emblems.`
            : `These ${inventory.length} emblems carry fewer than ${slots} different ` +
              `stats, and no stat may appear twice on a banner.`,
      caveats: [],
    }
  }

  const ranked = [found.best, ...found.alternatives]
  return {
    ...head,
    best: shape(found.best),
    alternatives: found.alternatives.map(shape),
    tied: overlapping(found.best, ranked, (b) => b.bannerId),
    worstOrder: found.worstOrder ? shape(found.worstOrder) : null,
    reason: null,
    caveats: [
      ...unmeasurableCaveats(found.best.emblems),
      ...new Set(unit.members.flatMap((m) => m.warnings)),
      ...(found.rescored < found.arrangements
        ? [
            `All ${found.arrangements.toLocaleString("en")} arrangements were compared on a ` +
              `${config.search.screenSims}-simulation screen that draws the same games for ` +
              `every one of them; only the ${found.rescored} shown were rescored at ` +
              `${config.scoring.sims} with an interval. A banner the screen misplaced by ` +
              `less than its own sampling error could be missing from this list.`,
          ]
        : []),
    ],
  }
}
