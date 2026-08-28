import { createHash } from "node:crypto"

import { Router } from "express"

import { config } from "../config.js"
import { runStore } from "../run-store.js"
import { slotGameScores } from "../scoring/banner.js"
import { indexRun, type RunIndex } from "../scoring/decode.js"
import type { DecodedProjection } from "../scoring/decode.js"
import { project, recencyWeights } from "../scoring/project.js"
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
}

/** Decoded sample matrices, built once per run rather than per request. */
let cachedIndex: { runId: string; index: RunIndex } | null = null

function indexFor(payload: RunPayload): RunIndex {
  if (cachedIndex?.runId !== payload.run.runId) {
    cachedIndex = { runId: payload.run.runId, index: indexRun(payload) }
  }
  return cachedIndex.index
}

/**
 * Memoised answers, keyed by request body and run.
 *
 * A projection costs thousands of draws, the inputs are a small set of emblem
 * ids, and a run is immutable -- so the same question has the same answer for
 * the life of the process. The cap is a plain LRU: this is a public endpoint
 * with no auth, and an unbounded map keyed on user input is a memory leak
 * waiting for a bored visitor.
 */
const MEMO_LIMIT = 500
const memo = new Map<string, unknown>()

function remember<T>(key: string, compute: () => T): T {
  const hit = memo.get(key)
  if (hit !== undefined) {
    memo.delete(key) // re-insert to make it most-recently-used
    memo.set(key, hit)
    return hit as T
  }
  const value = compute()
  memo.set(key, value)
  if (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value!)
  return value
}

rankRouter.post("/player/rank", (req, res) => {
  const payload = runStore.payload
  if (!payload) {
    res.status(404).json({ error: "no_current_run", reason: runStore.state.status })
    return
  }

  const body = (req.body ?? {}) as RankBody
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
  // The client forbids a repeated stat. Enforced here too: the two directions
  // must agree about what a legal banner is.
  const stats = new Set(banner.map((e) => e.stat))
  if (stats.size !== banner.length) {
    res.status(400).json({
      error: "repeated_stat",
      reason: "a banner may repeat a colour but never a stat",
    })
    return
  }

  const key = createHash("sha1")
    .update(payload.run.runId)
    .update(role)
    .update(banner.map((e) => e.emblemId).join("|"))
    .digest("hex")

  res.json(remember(key, () => rank(payload, banner, role)))
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

const LANES: Record<FantasyRole, string[]> = {
  core: ["carry", "offlane"],
  mid: ["mid"],
  support: ["soft_support", "hard_support"],
}

function rank(payload: RunPayload, banner: Emblem[], role: FantasyRole) {
  const index = indexFor(payload)
  const asOf = Date.parse(payload.run.params.asOf) / 1000
  const halfLife = payload.run.params.statHalfLife

  const byTeam = new Map<number, Player[]>()
  for (const p of payload.players) {
    if (!LANES[role].includes(p.lane)) continue
    byTeam.set(p.teamId, [...(byTeam.get(p.teamId) ?? []), p])
  }

  const units: ScoredUnit[] = []
  for (const [teamId, players] of byTeam) {
    const projection = index.projectionOf.get(teamId)
    // A team with no projection is not in this stage -- eliminated teams are
    // absent rather than scored as zero.
    if (!projection) continue

    const members = players.map((p) => index.samplesOf.get(p.playerId)).filter((s) => !!s)
    if (members.length !== players.length) continue

    const { scores, startTime, weight } = slotGameScores(members, banner, payload.scoring, index)
    if (scores.length === 0) continue

    const weights = recencyWeights(startTime, weight, halfLife, asOf)
    const { score, ci } = project(scores, weights, projection, {
      sims: config.scoring.sims,
      boot: config.scoring.boot,
      seed: config.scoring.seed,
    })

    units.push({
      unitId: `${role}/${teamId}`,
      teamId,
      role,
      players,
      score,
      ci,
      nGames: scores.length,
      warnings: members.flatMap((m) => m.warnings),
      projection,
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
  const tied = units
    .filter((u) => u.unitId !== best.unitId && u.ci.lo <= best.ci.hi && best.ci.lo <= u.ci.hi)
    .map((u) => u.unitId)

  const shape = (u: ScoredUnit) => ({
    unitId: u.unitId,
    teamId: u.teamId,
    role: u.role,
    players: u.players,
    score: u.score,
    ci: u.ci,
  })

  const unmeasurable = banner.filter((e) => !e.measurable)
  const caveats = [
    ...unmeasurable.map(
      (e) =>
        `${e.displayName}: no data for ${e.stat} at any depth, so it scores 0 for ` +
        `every unit. It is worth real points in the client -- the model cannot see them.`,
    ),
    ...new Set(best.warnings),
  ]

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
    caveats,
  }
}
