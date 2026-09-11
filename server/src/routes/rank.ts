import { Router } from "express"

import { config } from "../config.js"
import { createMemo } from "../memo.js"
import { runStore } from "../run-store.js"
import { overlapping, unmeasurableCaveats } from "../scoring/answer.js"
import { slotGameScores } from "../scoring/banner.js"
import type { DecodedProjection } from "../scoring/decode.js"
import { project, recencyWeights } from "../scoring/project.js"
import { bannerRejection } from "../scoring/slots.js"
import { indexFor, unitsOf } from "../scoring/units.js"
import type { Emblem, FantasyRole, Player, RunPayload } from "../validate.js"

/**
 * POST /api/player/rank
 *
 * Given a banner, which units score best through it. The ranking unit is a
 * team's DUO for core and support and a single player for mid, because the
 * client scores a role, not a person: a duo shares one banner and its score is
 * the pair's average.
 */
export const rankRouter: Router = Router()

interface RankBody {
  emblems?: { emblemId?: string; order?: number }[]
  role?: FantasyRole
  /** Which run to score against. Both narrow; neither is required. */
  tournamentId?: string
  stage?: string
}

const memo = createMemo(500)

rankRouter.post("/player/rank", (req, res) => {
  const body = (req.body ?? {}) as RankBody
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
        "A banner is scored by a slot. core and support are duos and mid is a " +
        "single player, so the unit being ranked depends on which you mean.",
    })
    return
  }

  const catalog = new Map(payload.emblems.map((e) => [e.emblemId, e]))
  const requested = body.emblems ?? []
  const banner: Emblem[] = []
  for (const entry of [...requested].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const emblem = entry.emblemId ? catalog.get(entry.emblemId) : undefined
    if (!emblem) {
      res.status(400).json({ error: "unknown_emblem", reason: `no emblem ${entry.emblemId}` })
      return
    }
    banner.push(emblem)
  }
  if (banner.length === 0) {
    res.status(400).json({ error: "empty_banner", reason: "send at least one emblem" })
    return
  }
  // Both of the client's rules, enforced here too: the directions of the tool
  // must agree about what a legal banner even is. The colour one is the
  // load-bearing half -- a slot's colour is fixed by role, so it decides which
  // six stats can sit there at all.
  const rejection = bannerRejection(banner, payload.scoring, role, banner.length)
  if (rejection) {
    res.status(400).json({ error: "illegal_banner", reason: rejection })
    return
  }

  const key = memo.key(payload.run.runId, role, banner.map((e) => e.emblemId).join("|"))
  res.json(memo.remember(key, () => rank(payload, banner, role)))
})

/** One candidate answer, before it is trimmed for the wire. */
interface ScoredUnit {
  unitId: string
  teamId: number
  role: FantasyRole
  players: Player[]
  score: number
  ci: { lo: number; hi: number }
  nGames: number
  warnings: string[]
  projection: DecodedProjection
}

function rank(payload: RunPayload, banner: Emblem[], role: FantasyRole) {
  const index = indexFor(payload)
  const asOf = Date.parse(payload.run.params.asOf) / 1000
  const halfLife = payload.run.params.statHalfLife

  const units: ScoredUnit[] = []
  for (const unit of unitsOf(payload, role, index)) {
    const { scores, startTime, weight } = slotGameScores(
      unit.members,
      banner,
      payload.scoring,
      index,
    )
    if (scores.length === 0) continue

    const weights = recencyWeights(startTime, weight, halfLife, asOf)
    const { score, ci } = project(scores, weights, unit.projection, {
      sims: config.scoring.sims,
      boot: config.scoring.boot,
      seed: config.scoring.seed,
    })

    units.push({
      unitId: unit.unitId,
      teamId: unit.teamId,
      role: unit.role,
      players: unit.players,
      score,
      ci,
      nGames: scores.length,
      warnings: unit.members.flatMap((m) => m.warnings),
      projection: unit.projection,
    })
  }

  units.sort((a, b) => b.score - a.score)
  const best = units[0]
  if (!best) {
    return { runId: payload.run.runId, computedAt: new Date().toISOString(), best: null }
  }

  // Overlapping intervals are a tie, not a ranking. On these banners that is the
  // common case, and printing 1-2-3 over it would state a distinction the
  // sampling error denies.
  const tied = overlapping(best, units, (u) => u.unitId)

  const shape = (u: ScoredUnit) => ({
    unitId: u.unitId,
    teamId: u.teamId,
    role: u.role,
    players: u.players,
    score: u.score,
    ci: u.ci,
  })

  return {
    runId: payload.run.runId,
    computedAt: new Date().toISOString(),
    best: shape(best),
    alternatives: units.slice(1, 10).map(shape),
    tied,
    tournamentContext: {
      expectedSeries: best.projection.expectedSeries,
      advanceProb: best.projection.advanceProb,
      eliminationRisk: best.projection.eliminationRisk,
    },
    caveats: [...unmeasurableCaveats(banner), ...new Set(best.warnings)],
  }
}
