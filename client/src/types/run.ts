/**
 * The client's view of the contract.
 *
 * The run payload types are RE-EXPORTED from `shared/run-types.ts`, which is
 * generated from `shared/run-schema.json`. They are never redeclared here: a
 * second hand-kept copy of a contract drifts from the first silently, which is
 * exactly what the schema exists to prevent.
 *
 * What IS declared here is the API response envelope -- the shape of an *answer*
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

import type { OverlayStatus } from "@/types/admin"

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
 * matrices -- those are megabytes only the scorer reads.
 *
 * `available` lists every run the server holds, so a switcher can offer the
 * other stages without a second round trip -- and so a stage nobody has
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
  /**
   * What an administrator has changed about this run since it was published,
   * or null when it is being served exactly as the engine made it.
   *
   * On the wire rather than inferred, for the same reason `gatesForced` is:
   * a reader acting on a projection is entitled to know that one of the numbers
   * behind it was typed this afternoon and has not been through a crawl. An
   * override that only the person who made it can see is the failure this whole
   * stack is built against, wearing a friendlier face.
   *
   * Optional, because a browser can be replaying a cached response from a
   * server that predates the field.
   */
  overlay?: OverlayStatus | null
  /** The server's own bounds, shipped so the client cannot offer a choice that
   * will be rejected. `maxInventory` is a latency budget, not a rule of the
   * game: owned emblems in `run.bannerSlots` slots is a permutation count. */
  limits: { maxInventory: number }
  /**
   * How long this response may be treated as current, in seconds -- the same
   * number the server put in its own `Cache-Control`.
   *
   * An hour where no overlay can exist, and `overlayCacheSeconds` where one
   * can. See `useRun`: the query cache has to honour this too, because a query
   * that stays fresh past it never revalidates and the header expiring is
   * never consulted.
   *
   * Optional, because a browser can be replaying a cached response from a
   * server that predates the field.
   */
  cacheSeconds?: number
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
  /** Units whose interval overlaps `best` -- rendered as tied, never as losers. */
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

/**
 * What the search compared, which is not the same thing in both directions.
 *
 * `/api/banner/optimize` walks every arrangement of an inventory. The target
 * search cannot -- the catalog in five slots is about 10^13 orderings -- so it
 * solves the quality-and-trait half exactly and screens the stat half. Those
 * are different claims, and the reader is the only one who can decide whether
 * the difference matters, so `kind` is on the wire rather than inferred from
 * which screen happens to be open.
 */
export type BannerSearchDetail =
  | {
      kind: "inventory"
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
  | {
      kind: "catalog"
      slots: number
      /** Emblems the run can generate, all of them in scope. */
      catalog: number
      /** Quality/trait configurations on the Pareto front, all compared. */
      profiles: number
      /** Stats that entered the search, of `statsTotal`. The approximation. */
      statsConsidered: number
      statsTotal: number
      candidates: number
      arrangements: number
      rescored: number
      screenSims: number
      sims: number
      nGames: number
    }

/** What `POST /api/banner/optimize` and `POST /api/banner/target` return: the
 * other direction of the same question, with a banner where the ranked answer
 * used to be a duo. Both shapes are identical apart from `search`, so one panel
 * draws them and a reader comparing goal against inventory compares like with
 * like. */
/**
 * One rung of the goal ladder.
 *
 * A goal is a statement about QUALITY, because quality is the half of a banner
 * no token can buy: the client rerolls a stat or a trait and never a tier. So
 * `qualities` is what the answer assumes you crafted, and everything else in
 * the banner is what the search bought with rerolls inside that hand.
 *
 * Sent by the server with every answer rather than written down here. A second
 * definition of "Ambitious" in the client is one that drifts from the one the
 * search actually used, and the label would go on drawing either way.
 */
export interface Goal {
  id: "realistic" | "ambitious" | "extreme" | "perfect"
  label: string
  /** Worst first, at this period's length. */
  qualities: string[]
  /** What this rung asks of the reader, in one sentence. */
  asks: string
}

/**
 * What the rerolls to reach a banner cost, and whether the period pays for it.
 *
 * Neither reroll is a choice -- a stat reroll lands on a stat of that colour
 * that is new and not already worn, a trait reroll on a different trait -- so
 * reaching a NAMED banner costs several tokens per emblem. `tokens` is null
 * where the client's budget for that period was never transcribed, and
 * `withinBudget` is then null too rather than a reassuring number.
 */
export interface RerollCost {
  statPools: number[]
  traitPool: number
  expected: number
  tokens: number | null
  withinBudget: number | null
}

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
  /** Banner ids whose interval overlaps `best` -- rendered as tied. */
  tied: string[]
  /** The winning emblems in their WORST order, so the value of order alone is a
   * measured gap. Null when the set has only one arrangement. */
  worstOrder: RankedBanner | null
  reason: string | null
  /** Which rung this answer is. Absent from the inventory direction, which is
   * about emblems you already hold and so has no crafting to assume. */
  goal?: Goal
  /** Every rung, so the selector is drawn from the server's own ladder. */
  ladder?: Goal[]
  /** What reaching this banner costs in tokens, or null when the colour row is
   * unknown. */
  rerolls?: RerollCost | null
  /** What the search actually did. On screen because an exhaustive comparison
   * and a screened one are different claims about the same list. */
  search: BannerSearchDetail
  tournamentContext: {
    expectedSeries: number
    advanceProb: number
    eliminationRisk: number
  }
  caveats: string[]
}


