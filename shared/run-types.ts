/* eslint-disable */
/**
 * GENERATED FILE -- do not edit.
 * Source: shared/run-schema.json
 * Regenerate: cd server && npm run gen:types
 */

/**
 * Fantasy resets per stage: its own roster, its own banner, its own answer. Banner size differs between them, so nothing may assume an emblem count.
 */
export type Stage = "group" | "main"
/**
 * The slot the client scores. core and support are duos; mid is one player.
 */
export type FantasyRole = "core" | "mid" | "support"
export type Lane = "carry" | "mid" | "offlane" | "soft_support" | "hard_support"
/**
 * A typed-array payload. Stored as BSON Binary, carried here as base64.
 */
export type Base64Binary = string

/**
 * The contract between the Python engine and the compute server. Python validates against this on write; the server validates on read; the client's types are generated from it. One file, three consumers, so a change is a single commit. Binary matrices travel as base64 in this canonical form: the publisher encodes before validating and writes BSON Binary, and the server decodes after validating. Byte lengths are invariants the schema cannot express and both sides assert in code -- games is nGames * nStats * 4 bytes, matchId and startTime are 8 bytes per row and the other scalars 4 (1 for won), seriesSamples is nShapeSamples * maxSeries bytes.
 */
export interface RunPayload {
  run: RunMeta
  scoring: Scoring
  /**
   * @minItems 1
   */
  teams: [Team, ...Team[]]
  /**
   * @minItems 1
   */
  players: [Player, ...Player[]]
  /**
   * @minItems 1
   */
  emblems: [Emblem, ...Emblem[]]
  /**
   * @minItems 1
   */
  playerSamples: [PlayerSamples, ...PlayerSamples[]]
  /**
   * @minItems 1
   */
  stageProjections: [StageProjection, ...StageProjection[]]
  factorAudit: FactorAudit[]
}
/**
 * One immutable snapshot. Never updated -- a correction is a new run.
 */
export interface RunMeta {
  runId: string
  tournamentId: string
  stage: Stage
  /**
   * Emblems per War Banner in this stage: three in a Group Stage, five in a Main Event. Carried on the run because it is a property of the period, not of the word 'main' -- a client that infers it from the stage name is one format change away from scoring a banner it never saw.
   */
  bannerSlots: number
  schemaVersion: 1
  createdAt: string
  /**
   * Git SHA of the engine that produced this run.
   */
  engineVersion: string
  /**
   * Hash over that tournament's config directory, so a run traces to the inputs that made it.
   */
  configHash: string
  params: {
    /**
     * Days. Decays stat means AND bootstrap weights. Differs from ratingHalfLife; publishing only one makes the server's recency weights silently wrong.
     */
    statHalfLife: number
    /**
     * Days. Decays the Bradley-Terry fit.
     */
    ratingHalfLife: number
    /**
     * The timestamp both decays are measured against.
     */
    asOf: string
    l2Prior: number
    patchStrength: number
    sims: number
  }
  dataWindow: {
    from: string
    to: string
    matchCount: number
  }
  /**
   * Freshness gates overridden with --force at publish. Empty is the normal case; a non-empty list is why a wrong number was allowed to ship.
   */
  gatesForced: string[]
  /**
   * Scoped per {tournamentId, stage}, never global.
   */
  isCurrent: boolean
  /**
   * Reroll tokens for this period, or null where the client's number was never transcribed. A token buys one stat reroll or one trait reroll, and neither is a choice -- the client rolls a stat that is new and not already on the banner, or a trait that is different -- so a named banner costs several tokens per emblem in expectation rather than one. Quality is not rerollable at all, which is why the budget prices the stats and traits of a goal and never its tiers. Null is not zero and not 'enough': it means the budget half of a goal's feasibility cannot be answered, and the tool says so rather than passing a check against a number nobody wrote down. Optional: runs published before the field existed carry none.
   */
  rerollTokens?: number | null
}
/**
 * The client's scoring table, published so the server can score a banner without a second copy of scoring.yaml. Stat values are wildly unequal (Creep Score 3 per unit, Roshan 1172), so a raw rate means nothing until it is multiplied through this.
 */
export interface Scoring {
  version: string
  verifiedAgainstClient: boolean
  colors: string[]
  /**
   * Fantasy role -> the colour of each banner slot, at the longest period's length. A shorter period takes the first bannerSlots of the row, because the emblems carry over. This is the rule that decides which stats a slot can hold at all: Core is red-green-red-green-red and Support has no red slot, so it is not a preference and not one-of-each. Optional: a run published before this field existed carries no row, and the tool degrades rather than refusing to start -- rank and optimize keep working under the stat rule alone, and the target search declines to answer instead of guessing a sequence. Republish with publish.py to get the rule back.
   */
  bannerColors?: {
    [k: string]: string[]
  }
  /**
   * Scoring-stat key -> what it pays. `source` is the column name in playerSamples.stats; `measurable` false means the source data has no field for it at any depth.
   */
  stats: {
    [k: string]: {
      perUnit: number
      base: number
      color: string
      measurable: boolean
      source?: string | null
    }
  }
  /**
   * Emblem tier -> multiplier bonus.
   */
  quality: {
    [k: string]: number
  }
  /**
   * Trait -> its own bonus and what it does to each NEIGHBOUR. Vampiric charges adjacent emblems -0.10 and Benevolent pays them +0.20, which is why an emblem's displayed percentage is a property of an arrangement rather than of the emblem.
   */
  traits: {
    [k: string]: {
      bonus: number
      adjacentBonus: number
      /**
       * The condition in words, for the reader. Prose only -- it is displayed, never evaluated.
       */
      condition?: string | null
      /**
       * Which of the scorer's implemented rules gates this trait's OWN bonus. The rule is code and the name of it is data, so that a trait added or renamed without a release cannot quietly fall through to paying unconditionally. Absent on a run published before this field existed, and the scorer then falls back to matching on the trait's name -- correct for the five traits that shipped with the client, and exactly the fallback a new trait must not rely on.
       */
      conditionRule?: null | "always" | "never" | "allQualitiesDiffer" | "countAtLeast3" | "onlyOne" | "neighboursOnly"
    }
  }
}
export interface Team {
  teamId: number
  tournamentId: string
  name: string
  tag?: string
  region?: string
  logoUrl?: string
  /**
   * Other OpenDota ids the same org played under. Load-bearing: one org carrying two ids splits its evidence in half and the model rates it on the remainder, with no error.
   */
  alsoTeamIds: number[]
}
export interface Player {
  playerId: number
  tournamentId: string
  nick: string
  teamId: number
  fantasyRole: FantasyRole
  lane: Lane
}
/**
 * One row of the full generatable catalog -- every stat x tier x trait the client can produce, generated from scoring.yaml. NOT the emblems on one rolled banner.
 */
export interface Emblem {
  emblemId: string
  tournamentId: string
  stage: Stage
  stat: string
  tier: string
  /**
   * Required, because the displayed multiplier is derived from tier + trait + NEIGHBOURS. Vampiric charges each adjacent emblem -10%, Benevolent pays each +20%. Store the multiplier instead and every ordering scores identically.
   */
  trait: string
  displayName: string
  /**
   * False for stats with no field in the source data at any depth. Such an emblem scores zero for everyone -- excluded from valuation, never scored as a zero, and surfaced as a caveat.
   */
  measurable: boolean
}
/**
 * Per-player, per-game stat lines AFTER the engine's factor stack. Publishing raw lines would make the server disagree with the engine.
 */
export interface PlayerSamples {
  runId: string
  playerId: number
  /**
   * Column order of the games matrix.
   *
   * @minItems 1
   */
  stats: [string, ...string[]]
  games: Base64Binary
  nGames: number
  /**
   * A typed-array payload. Stored as BSON Binary, carried here as base64.
   */
  matchId: string
  /**
   * A typed-array payload. Stored as BSON Binary, carried here as base64.
   */
  heroId: string
  /**
   * A typed-array payload. Stored as BSON Binary, carried here as base64.
   */
  won: string
  /**
   * A typed-array payload. Stored as BSON Binary, carried here as base64.
   */
  durationSeconds: string
  /**
   * A typed-array payload. Stored as BSON Binary, carried here as base64.
   */
  firstBloodTime: string
  /**
   * A typed-array payload. Stored as BSON Binary, carried here as base64.
   */
  startTime: string
  /**
   * A typed-array payload. Stored as BSON Binary, carried here as base64.
   */
  gameWeight: string
  /**
   * Counted on JOINT duo games, not per-player games, and naming the direction of the bias: the bootstrap cannot draw above an observed maximum, so a thin sample has its ceiling truncated under E[max]. Biased low, not merely uncertain.
   */
  sampleWarnings: string[]
}
export interface StageProjection {
  runId: string
  teamId: number
  stage: Stage
  swiss?: {
    bucketProbs: {
      [k: string]: number
    }
    advanceProb: number
  }
  bracket?: {
    placementProbs: {
      [k: string]: number
    }
    winProb: number
  }
  /**
   * A typed-array payload. Stored as BSON Binary, carried here as base64.
   */
  seriesSamples: string
  /**
   * A typed-array payload. Stored as BSON Binary, carried here as base64.
   */
  deciderSamples: string
  nSims: number
  /**
   * Shapes kept. Both simulators cap at 4,000 regardless of nSims, so collapsing the two makes a run look like it disagrees with itself.
   */
  nShapeSamples: number
  maxSeries: number
  expectedSeries: number
  eliminationRisk: number
}
/**
 * What each modelling factor was worth, including the ones that were measured and rejected, and the ones that are simply absent.
 */
export interface FactorAudit {
  runId: string
  factor: string
  /**
   * Measured, assumed, or unmodelled. Never let one masquerade as another.
   */
  kind: "data" | "assumption" | "absent"
  delta?: number | null
  ciCrossesZero?: boolean | null
  verdict: "keep" | "reject" | "missing"
  evidence?: string
}
