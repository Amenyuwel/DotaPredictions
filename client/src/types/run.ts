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
  Scoring,
  Stage,
  Team,
} from "@shared/run-types"

import type {
  FantasyRole,
  Emblem,
  Player,
  RunMeta,
  Scoring,
  Stage,
  Team,
} from "@shared/run-types"

/** One run the server has loaded and can answer for. */
export interface AvailableRun {
  runId: string
  tournamentId: string
  stage: Stage
  createdAt: string
}

/** What `GET /api/run/current` returns: metadata and catalogues, no sample
 * matrices — those are megabytes only the scorer reads.
 *
 * `available` lists every run the server holds, so a switcher can offer the
 * other stages without a second round trip — and so a stage nobody has
 * published is absent from the switcher rather than selectable and then
 * broken.
 *
 * `scoring` rides along because it is where an emblem's COLOUR is defined. The
 * client splits the emblem picker by colour, and reading it from the published
 * table means there is no second colour map in the browser to fall out of step
 * with `scoring.yaml`. */
export interface CurrentRun {
  run: RunMeta
  scoring: Scoring
  teams: Team[]
  players: Player[]
  emblems: Emblem[]
  available: AvailableRun[]
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
  /** null when no unit in this stage has a joint sample to score. */
  best: RankedUnit | null
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
