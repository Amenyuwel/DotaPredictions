/**
 * The shapes the server returns.
 *
 * These are hand-written for now and MUST be replaced by types generated from
 * `shared/run-schema.json` (via `json-schema-to-typescript`) as soon as that
 * file exists. The schema is the single source of truth; a second hand-kept
 * copy of the contract is exactly the silent drift the project's DRY rule
 * exists to prevent. Until then, treat this file as a stub with a deadline.
 */

export type Stage = "group" | "main"

export type FantasyRole = "core" | "mid" | "support"

export interface RunMeta {
  runId: string
  tournamentId: string
  stage: Stage
  createdAt: string
  engineVersion: string
  /** Which freshness gates, if any, were overridden with --force at publish. */
  gatesForced: string[]
  dataWindow: { from: string; to: string; matchCount: number }
}

export interface Team {
  teamId: number
  name: string
  tag?: string
  region?: string
}

export interface Player {
  playerId: number
  nick: string
  teamId: number
  fantasyRole: FantasyRole
  lane: string
}

export interface Emblem {
  emblemId: string
  stat: string
  tier: string
  trait: string
  displayName: string
  /**
   * False for stats with no field in the source data at any depth. Such an
   * emblem scores zero for every player, so the UI marks it up front rather
   * than presenting a computed zero as a finding.
   */
  measurable: boolean
}

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
