import type { DecodedProjection, DecodedSamples, RunIndex } from "./decode.js"
import { indexRun } from "./decode.js"
import type { FantasyRole, Lane, Player, RunPayload } from "../validate.js"

/**
 * The thing a banner is worn by.
 *
 * Both directions of the tool score the same object, so both resolve it here.
 * A duo for core and support and a single player for mid, because the client
 * scores a ROLE rather than a person: two players share one banner and the
 * slot's score is the pair's average. Resolving it twice would be two answers
 * to "who is the Core of team 9" that could disagree about a stand-in.
 */

/** Which lanes make up each slot. The lane is the roster fact; `fantasyRole` is
 * the label the client puts on it, and the lane is what the samples carry. */
export const LANES: Record<FantasyRole, Lane[]> = {
  core: ["carry", "offlane"],
  mid: ["mid"],
  support: ["soft_support", "hard_support"],
}

export interface Unit {
  unitId: string
  teamId: number
  role: FantasyRole
  players: Player[]
  /** One decoded sample matrix per member, in `players` order. */
  members: DecodedSamples[]
  projection: DecodedProjection
}

/**
 * Decoded sample matrices, built once per run rather than per request.
 *
 * Keyed by runId rather than held as a single slot, because two stages are now
 * reachable and a client switching between them would otherwise re-decode
 * megabytes of Float32 on every toggle. Bounded, because the key comes from the
 * store rather than from a request: it can only ever hold the runs that were
 * loaded at boot.
 */
const indices = new Map<string, RunIndex>()

export function indexFor(payload: RunPayload): RunIndex {
  const existing = indices.get(payload.run.runId)
  if (existing) return existing
  const index = indexRun(payload)
  indices.set(payload.run.runId, index)
  return index
}

/**
 * Every scoreable unit in one slot.
 *
 * A team is skipped rather than scored as zero when it has no projection (it is
 * not in this stage -- eliminated teams are absent) or when any member has no
 * sample matrix. A half-resolved duo would be scored as a solo player with the
 * other half's contribution missing, which looks like a weak duo rather than
 * like missing data.
 */
export function unitsOf(payload: RunPayload, role: FantasyRole, index: RunIndex): Unit[] {
  const byTeam = new Map<number, Player[]>()
  for (const p of payload.players) {
    if (!LANES[role].includes(p.lane)) continue
    byTeam.set(p.teamId, [...(byTeam.get(p.teamId) ?? []), p])
  }

  const units: Unit[] = []
  for (const [teamId, players] of byTeam) {
    const projection = index.projectionOf.get(teamId)
    if (!projection) continue
    const members = players.map((p) => index.samplesOf.get(p.playerId)).filter((s) => !!s)
    if (members.length !== players.length) continue
    units.push({ unitId: `${role}/${teamId}`, teamId, role, players, members, projection })
  }
  return units
}

/** One slot of one team, or null when that slot is not scoreable in this run. */
export function unitOf(
  payload: RunPayload,
  role: FantasyRole,
  teamId: number,
  index: RunIndex,
): Unit | null {
  return unitsOf(payload, role, index).find((u) => u.teamId === teamId) ?? null
}
