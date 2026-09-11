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
  /** The teams this stage projects, which is not every team with a roster here.
   * A Main Event payload carries all sixteen rosters and eight projections, so
   * a picker built from `teams` would offer eight sides that were knocked out.
   * Same rule as the stage switcher: what cannot be answered is absent. */
  stageTeamIds: number[]
  /** The server's own bounds, shipped so the client cannot offer a choice that
   * will be rejected. `maxInventory` is a latency budget, not a rule of the
   * game: owned emblems in `run.bannerSlots` slots is a permutation count. */
  limits: { maxInventory: number }
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

/** One arrangement of owned emblems, scored. Order is part of the identity:
 * Vampiric charges each neighbour -10% and Benevolent pays each +20%, so the
 * same five emblems in two orders are two different banners. */
export interface RankedBanner {
  bannerId: string
  /** Top to bottom, as the client draws it. */
  emblems: Emblem[]
  /** What the client stamps on each emblem, in banner order. 3 is "300%". */
  multipliers: number[]
  score: number
  ci: { lo: number; hi: number }
}

/** What `POST /api/banner/optimize` returns: the other direction of the same
 * question, with a banner where the ranked answer used to be a duo. */
export interface BannerAnswer {
  runId: string
  computedAt: string
  unit: { unitId: string; teamId: number; role: FantasyRole; players: Player[] }
  /** null when no legal banner could be built, or the unit has no joint games.
   * `reason` then says which. */
  best: RankedBanner | null
  /** The best arrangement of each OTHER emblem set. Never a reordering of the
   * winner -- what the order is worth is `worstOrder`, said once. */
  alternatives: RankedBanner[]
  /** Banner ids whose interval overlaps `best` — rendered as tied. */
  tied: string[]
  /** The winning emblems in their WORST order, so the value of order alone is a
   * measured gap. Null when the set has only one arrangement. */
  worstOrder: RankedBanner | null
  reason: string | null
  /** What the search actually did. On screen because an exhaustive comparison
   * and a screened one are different claims about the same list. */
  search: {
    inventory: number
    slots: number
    arrangements: number
    subsets: number
    rescored: number
    screenSims: number
    sims: number
    /** Matches where every member of the unit played. */
    nGames: number
  }
  tournamentContext: {
    expectedSeries: number
    advanceProb: number
    eliminationRisk: number
  }
  caveats: string[]
}

export type { Emblem as EmblemOption }
