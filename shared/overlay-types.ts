/* eslint-disable */
/**
 * GENERATED FILE -- do not edit.
 * Source: shared/overlay-schema.json
 * Regenerate: cd server && npm run gen:types
 */

/**
 * An identifier the rest of the stack uses as an object key and a URL-safe token. Deliberately narrow: a stat called `gold per min` would key fine here and break every place that splits an emblemId on a colon.
 */
export type Key = string
/**
 * A multiplier bonus as a fraction. Bounded well outside anything Valve has shipped and well inside absurdity: the range is not a claim about what is correct, it is a guard against a decimal point in the wrong place turning a 1.5 into a 15 that nothing downstream would question.
 */
export type Bonus = number
/**
 * A positive integer id written as a string, because JSON object keys are strings and a silent Number() round trip on a 17-digit Steam id is exactly the kind of quiet corruption this project exists to avoid.
 */
export type NumericKey = string

/**
 * An admin-authored patch over a published run. Nothing here changes what was measured -- playerSamples and stageProjections are absent by construction, because the crawler is the only thing allowed to write a measurement. Everything here is a table the server reads at request time, so applying it needs no re-crawl and no engine run. One mechanism per entity: a patch map keyed by id, plus a list of ids to remove. An entry whose key the run does not carry is an ADDITION, and the apply step then requires it to be complete rather than merging it onto nothing.
 */
export interface ConfigOverlay {
  /**
   * Bumped when the shape below changes incompatibly. A server that does not recognise the number refuses the overlay and serves the published run unchanged, which is the safe direction: an overlay it cannot read is an overlay it cannot half-apply.
   */
  schemaVersion: 1
  /**
   * The half of a run that is recomputed per request. Omit a key to leave the published value alone; omitting the whole object leaves the published scoring table untouched.
   */
  scoring?: {
    /**
     * Stat key -> fields to change. Merged over the published spec, so a partial entry moves only what it names. A key the run does not carry is a NEW stat and must name every field, `source` included -- see the note on `source`.
     */
    stats?: {
      [k: string]: StatPatch
    }
    /**
     * Stat keys to drop entirely. Every emblem carrying the stat disappears with it, which is the point: a stat that pays nothing and an emblem that cannot be built are the same statement, and leaving the emblem behind would offer a choice that scores zero.
     */
    statsRemoved?: Key[]
    /**
     * Emblem tier -> its multiplier bonus, as a fraction (Tier V at +150% is 1.5). A key the run does not carry adds a tier, and a new tier multiplies the emblem catalog by one more row per stat per trait.
     */
    quality?: {
      [k: string]: Bonus
    }
    qualityRemoved?: Key[]
    /**
     * Trait -> what it pays itself and what it does to each NEIGHBOUR. Merged over the published spec like stats. A trait whose name the scorer has no rule for pays its flat `bonus` unconditionally -- see `conditionRule`.
     */
    traits?: {
      [k: string]: TraitPatch
    }
    traitsRemoved?: Key[]
    /**
     * The palette, replaced whole rather than patched -- it is an ordered list of three-ish names and a per-index patch over it would be unreadable. Absent means the published palette stands.
     *
     * @minItems 1
     */
    colors?: [Key, ...Key[]]
    /**
     * Fantasy role -> the colour of each banner slot, at the longest period's length. Replaced per role, not per slot: a row is the shape of a banner and half a row is not a shape. This decides which stats a slot can hold at all, so a row naming a colour no stat carries makes that slot unfillable -- rejected at apply time rather than discovered as an empty picker.
     */
    bannerColors?: {
      /**
       * @minItems 1
       */
      [k: string]: [Key, ...Key[]]
    }
  }
  /**
   * OpenDota team id (as a string key) -> fields to change. A key the run does not carry adds a team, which then needs `name`. An added team has no stageProjection, so it is absent from every picker until a re-crawl gives it one -- it is not a team scored as zero.
   */
  teams?: {
    [k: string]: TeamPatch
  }
  /**
   * Team ids to drop. Their players go with them: a player on no team cannot be ranked, and leaving them behind would put an orphan in a picker.
   */
  teamsRemoved?: NumericKey[]
  /**
   * OpenDota account id (as a string key) -> fields to change. A key the run does not carry adds a player, which then needs `nick`, `teamId`, `fantasyRole` and `lane`. An added player has no sample matrix and is therefore unrankable until a re-crawl -- reported as having no data, never scored as zero.
   */
  players?: {
    [k: string]: PlayerPatch
  }
  playersRemoved?: NumericKey[]
}
export interface StatPatch {
  /**
   * Points per unit of the stat. Signed: Deaths pays -195.
   */
  perUnit?: number
  /**
   * Points paid once if the stat is present at all, before any per-unit amount. Deaths carries 1950 here.
   */
  base?: number
  /**
   * An identifier the rest of the stack uses as an object key and a URL-safe token. Deliberately narrow: a stat called `gold per min` would key fine here and break every place that splits an emblemId on a colon.
   */
  color?: string
  /**
   * False means the source data has no field for this at any depth. Such a stat is excluded from emblem CHOICE rather than scored as zero, so that the tool never recommends an emblem it cannot value. Setting this true without a working `source` is the one edit here that can manufacture a confident wrong number, and the apply step refuses it.
   */
  measurable?: boolean
  /**
   * The column name in playerSamples.stats that carries this stat's per-game values, or null for a stat nothing measures. It cannot be invented: the run ships a fixed set of columns and a name outside that set measures nothing. The admin UI offers the run's own column list, and apply rejects anything else.
   */
  source?: string | null
}
export interface TraitPatch {
  bonus?: Bonus
  /**
   * A multiplier bonus as a fraction. Bounded well outside anything Valve has shipped and well inside absurdity: the range is not a claim about what is correct, it is a guard against a decimal point in the wrong place turning a 1.5 into a 15 that nothing downstream would question.
   */
  adjacentBonus?: number
  /**
   * The condition in words, for the reader. Prose only -- it is displayed, never evaluated. `conditionRule` is what the scorer reads.
   */
  condition?: string | null
  /**
   * Which of the scorer's implemented rules gates this trait's own bonus. These are the five the client has shipped and they are CODE, not data: `allQualitiesDiffer` scans the banner's tiers, `countAtLeast3` and `onlyOne` count the trait. A trait naming no rule pays `bonus` unconditionally, which is right for one that has none and wrong-and-silent for one whose rule was simply not named -- so the admin form makes this an explicit choice rather than a blank that defaults.
   */
  conditionRule?: null | "always" | "never" | "allQualitiesDiffer" | "countAtLeast3" | "onlyOne" | "neighboursOnly"
}
export interface TeamPatch {
  name?: string
  tag?: string
  region?: string
  logoUrl?: string
  /**
   * Other OpenDota ids the same org played under. Load-bearing rather than cosmetic: one org carrying two ids splits its evidence in half and the model rates it on the remainder with no error anywhere. Editing this here renames nothing retroactively -- the samples were already gathered under whatever ids the last crawl knew, so a correction added today takes effect at the next crawl and the UI says so.
   */
  alsoTeamIds?: number[]
}
export interface PlayerPatch {
  nick?: string
  teamId?: number
  /**
   * Which fantasy slot this player is picked into. Core and support are duos and mid is a single player, so moving someone between these changes what unit they are part of -- and a role with the wrong number of members in it is skipped rather than scored short-handed.
   */
  fantasyRole?: "core" | "mid" | "support"
  /**
   * The in-game position. `fantasyRole` follows from it in the published run, and the two are kept separate here because a stand-in can be slotted somewhere their lane label does not predict.
   */
  lane?: "carry" | "mid" | "offlane" | "soft_support" | "hard_support"
}
