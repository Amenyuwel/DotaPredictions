/**
 * The client's view of the contract.
 *
 * The run payload types are RE-EXPORTED from `shared/run-types.ts`, which is
 * generated from `shared/run-schema.json`. They are never redeclared here: a
 * second hand-kept copy of a contract drifts from the first silently, which is
 * exactly what the schema exists to prevent.
 *
 * What IS declared here is the API response envelope — the shape of an *answer*
 * rather than of a *run*. It is not in the schema because the engine does not
 * produce it; the server computes it per request. If it ever needs to be shared
 * with another consumer, it gets its own schema and this block disappears too.
 */
export type {
  Emblem,
  FantasyRole,
  Lane,
  Player,
  RunMeta,
  Stage,
  Team,
} from "@shared/run-types"

import type { FantasyRole, Emblem, Player, RunMeta, Team } from "@shared/run-types"

/** What `GET /api/run/current` returns: metadata and catalogues, no sample
 * matrices — those are megabytes only the scorer reads. */
export interface CurrentRun {
  run: RunMeta
  teams: Team[]
  players: Player[]
  emblems: Emblem[]
}

/** A ranked answer: a duo for core/support, a single player for mid. */
export interface RankedUnit {
  unitId: string
  teamId: number
  role: FantasyRole
  players: Player[]
  score: number
  ci: { lo: number; hi: number }
}

export interface AnswerResponse {
  runId: string
  computedAt: string
  best: RankedUnit
  alternatives: RankedUnit[]
  /** Units whose interval overlaps `best` — rendered as tied, never as losers. */
  tied: string[]
  tournamentContext: {
    expectedSeries: number
    advanceProb: number
    eliminationRisk: number
  }
  caveats: string[]
}

export type { Emblem as EmblemOption }
