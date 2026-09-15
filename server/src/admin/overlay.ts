import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js"

import type { ConfigOverlay } from "../../../shared/overlay-types.js"
import { assertRunPayload, type Emblem, type Player, type RunPayload, type Scoring, type Team } from "../validate.js"

/**
 * An admin's configuration overlay, applied to a published run.
 *
 * This module answers one question -- what does the run look like with this
 * patch on it -- and it is a pure function of two values, which is the only
 * reason the feature is safe to have. It reads no clock, no database and no
 * environment, so the effective run for a given (run, overlay) pair is the same
 * everywhere, forever, and a disagreement between two servers is impossible
 * rather than merely unlikely.
 *
 * What may be overlaid is decided by a fact about `scoring/banner.ts`, not by
 * policy: that file turns a stat line into points at REQUEST time, reading the
 * scoring table against raw per-game values. So the table is replaceable and
 * the measurements are not. `playerSamples` and `stageProjections` have no
 * representation in the overlay schema at all -- not "are rejected", but cannot
 * be expressed -- because the crawler is the only thing permitted to write down
 * what happened in a game.
 *
 * Three guards, in order, and the order matters:
 *
 *   1. `validateOverlay`   the shape, against shared/overlay-schema.json
 *   2. `assertAppliable`   the things JSON Schema cannot say -- a stat naming a
 *                          source column the run does not carry, a new player
 *                          on a team that does not exist, a slot colour no stat
 *                          can fill
 *   3. `assertRunPayload`  the RESULT, against the run contract itself
 *
 * The third is the one that makes this defensible. Whatever an overlay does,
 * what comes out the far side has been validated against exactly the schema the
 * engine's own output is validated against -- so an overlay cannot produce a
 * payload the server would have refused to boot on.
 */

const schemaPath = fileURLToPath(new URL("../../../shared/overlay-schema.json", import.meta.url))
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object

// `strict: false` and no ajv-formats, both for the same reason as validate.ts:
// this schema declares no formats, and strict mode rejects the annotation-only
// keywords the descriptions rely on.
const ajv = new Ajv2020({ allErrors: true, strict: false })
const validate: ValidateFunction<ConfigOverlay> = ajv.compile<ConfigOverlay>(schema)

/**
 * An overlay that could not be applied, with every reason rather than the first.
 *
 * Distinct from `SchemaMismatch`, which kills the process: a bad overlay is
 * somebody's typo in a form, and the right answer is to tell them all of what is
 * wrong and keep serving the published run untouched.
 */
export class OverlayRejected extends Error {
  readonly reasons: string[]

  constructor(reasons: string[]) {
    super(`overlay cannot be applied:\n  ${reasons.join("\n  ")}`)
    this.name = "OverlayRejected"
    this.reasons = reasons
  }
}

/** The empty overlay: valid, applies cleanly, changes nothing. */
export const EMPTY_OVERLAY: ConfigOverlay = { schemaVersion: 1 }

/**
 * The catalog size this server will serve.
 *
 * Stats x tiers x traits, and every one of the three is now something an admin
 * can add to -- so the product is a number a form can multiply by accident. The
 * bound is a latency fact, not a rule of the game: `/api/banner/target` prices
 * every legal candidate per slot before it shortlists, and the published TI 2026
 * catalog of 450 is two orders of magnitude under this. Refusing here names the
 * cause; letting it through would surface as request timeouts on a page that
 * gives no hint which edit caused them.
 */
const MAX_CATALOG = 5000

export function validateOverlay(doc: unknown): asserts doc is ConfigOverlay {
  if (validate(doc)) return
  throw new OverlayRejected(
    (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`),
  )
}

export interface AppliedRun {
  payload: RunPayload
  /**
   * What is true about this overlay that is not fatal. Surfaced to the admin
   * while editing AND to the public page alongside the answer -- a caveat only
   * the author ever sees is a caveat the reader is entitled to and does not get.
   */
  notes: string[]
  /** How many distinct entities the overlay actually moves. Zero means it is a
   * no-op, which is worth saying out loud: it is the state an overlay reaches
   * once a re-crawl has published the same values into the run itself. */
  changeCount: number
}

/**
 * The run as it should be served, with this overlay on it.
 *
 * Returns a new payload; the argument is never mutated. `run-store.ts` holds one
 * immutable published payload for the life of the process and hands the same
 * object to every request, so mutating here would rewrite the published run for
 * everyone, permanently, from one admin's draft preview.
 */
export function applyOverlay(published: RunPayload, doc: ConfigOverlay): AppliedRun {
  validateOverlay(doc)
  const notes: string[] = []

  const scoring = applyScoring(published, doc, notes)
  const { teams, players } = applyRoster(published, doc, notes)
  const emblems = buildEmblems(scoring, published.run.tournamentId, published.run.stage)

  const payload: RunPayload = {
    ...published,
    scoring,
    teams: teams as RunPayload["teams"],
    players: players as RunPayload["players"],
    emblems: emblems as RunPayload["emblems"],
  }

  assertAppliable(published, payload, doc, notes)

  // The result, against the run contract. Whatever the overlay did, what comes
  // out is a payload the engine could have published -- or nothing is served.
  try {
    assertRunPayload(payload)
  } catch (err) {
    throw new OverlayRejected([
      "the patched run no longer matches shared/run-schema.json, which means this " +
        "overlay would change what the bytes MEAN rather than what they say:",
      ...(err instanceof Error ? err.message.split("\n").slice(1) : [String(err)]),
    ])
  }

  return { payload, notes, changeCount: countChanges(doc) }
}

// ---------------------------------------------------------------------------
// scoring
// ---------------------------------------------------------------------------

function applyScoring(published: RunPayload, doc: ConfigOverlay, notes: string[]): Scoring {
  const patch = doc.scoring ?? {}
  const base = published.scoring

  const stats: Scoring["stats"] = { ...base.stats }
  for (const key of patch.statsRemoved ?? []) {
    if (!(key in stats)) {
      notes.push(`stat "${key}" is marked removed but the published run does not carry it.`)
      continue
    }
    delete stats[key]
  }
  for (const [key, entry] of Object.entries(patch.stats ?? {})) {
    const existing = stats[key]
    // A partial entry over an absent stat would produce a spec with default
    // zeros in it -- a stat that pays nothing, looks deliberate, and is
    // indistinguishable from one that was configured that way. `assertAppliable`
    // refuses it; this branch only keeps the merge honest in the meantime.
    stats[key] = {
      perUnit: entry.perUnit ?? existing?.perUnit ?? 0,
      base: entry.base ?? existing?.base ?? 0,
      color: entry.color ?? existing?.color ?? "",
      measurable: entry.measurable ?? existing?.measurable ?? false,
      source: entry.source !== undefined ? entry.source : (existing?.source ?? null),
    }
  }

  const quality: Scoring["quality"] = { ...base.quality }
  for (const key of patch.qualityRemoved ?? []) delete quality[key]
  for (const [key, bonus] of Object.entries(patch.quality ?? {})) quality[key] = bonus

  const traits: Scoring["traits"] = { ...base.traits }
  for (const key of patch.traitsRemoved ?? []) delete traits[key]
  for (const [key, entry] of Object.entries(patch.traits ?? {})) {
    const existing = traits[key]
    traits[key] = {
      bonus: entry.bonus ?? existing?.bonus ?? 0,
      adjacentBonus: entry.adjacentBonus ?? existing?.adjacentBonus ?? 0,
      condition: entry.condition !== undefined ? entry.condition : (existing?.condition ?? null),
      conditionRule:
        entry.conditionRule !== undefined
          ? entry.conditionRule
          : (existing?.conditionRule ?? null),
    }
  }

  const colors = patch.colors ? [...patch.colors] : [...base.colors]
  const bannerColors = base.bannerColors ? { ...base.bannerColors } : undefined
  const patchedBannerColors = patch.bannerColors ?? {}
  let effectiveBannerColors = bannerColors
  if (Object.keys(patchedBannerColors).length > 0) {
    effectiveBannerColors = { ...(bannerColors ?? {}) }
    for (const [role, row] of Object.entries(patchedBannerColors)) {
      effectiveBannerColors[role] = [...row]
    }
    if (!bannerColors) {
      notes.push(
        "The published run carries no banner_slot_colors, so this overlay is " +
          "introducing the slot-colour rule rather than correcting it. Check every " +
          "role's row against the client before publishing: this rule decides which " +
          "stats a slot can hold at all.",
      )
    }
  }

  const scoring: Scoring = {
    ...base,
    colors,
    stats,
    quality,
    traits,
  }
  if (effectiveBannerColors) scoring.bannerColors = effectiveBannerColors
  return scoring
}

// ---------------------------------------------------------------------------
// roster
// ---------------------------------------------------------------------------

function applyRoster(
  published: RunPayload,
  doc: ConfigOverlay,
  notes: string[],
): { teams: Team[]; players: Player[] } {
  const tournamentId = published.run.tournamentId

  const teams = new Map<number, Team>(published.teams.map((t) => [t.teamId, t]))
  for (const key of doc.teamsRemoved ?? []) teams.delete(Number(key))
  for (const [key, entry] of Object.entries(doc.teams ?? {})) {
    const teamId = Number(key)
    const existing = teams.get(teamId)
    teams.set(teamId, {
      teamId,
      tournamentId,
      name: entry.name ?? existing?.name ?? "",
      ...(entry.tag ?? existing?.tag ? { tag: entry.tag ?? existing?.tag } : {}),
      ...(entry.region ?? existing?.region ? { region: entry.region ?? existing?.region } : {}),
      ...(entry.logoUrl ?? existing?.logoUrl
        ? { logoUrl: entry.logoUrl ?? existing?.logoUrl }
        : {}),
      alsoTeamIds: entry.alsoTeamIds ? [...entry.alsoTeamIds] : [...(existing?.alsoTeamIds ?? [])],
    })
  }

  const players = new Map<number, Player>(published.players.map((p) => [p.playerId, p]))
  for (const key of doc.playersRemoved ?? []) players.delete(Number(key))
  for (const [key, entry] of Object.entries(doc.players ?? {})) {
    const playerId = Number(key)
    const existing = players.get(playerId)
    players.set(playerId, {
      playerId,
      tournamentId,
      nick: entry.nick ?? existing?.nick ?? "",
      teamId: entry.teamId ?? existing?.teamId ?? 0,
      fantasyRole: entry.fantasyRole ?? existing?.fantasyRole ?? ("core" as Player["fantasyRole"]),
      lane: entry.lane ?? existing?.lane ?? ("carry" as Player["lane"]),
    })
  }

  // A removed team takes its players with it. A player whose team is gone cannot
  // be ranked -- `unitsOf` groups by teamId and reads the projection for it --
  // and leaving them behind would put a name in a picker that resolves to
  // nothing. Cascading is stated in a note rather than done quietly, because
  // "remove one team" deleting nine rows is a surprise worth one line of text.
  //
  // ONLY for a team this overlay actually removed. A player pointed at an id
  // that was never a team is a typo, not a cascade, and dropping them here
  // would make "I added a player and nothing happened" the tool's answer --
  // the one failure an editing UI must never have. Those are left in place, so
  // `assertAppliable` refuses them by name.
  const removedTeams = new Set((doc.teamsRemoved ?? []).map(Number))
  const cascaded = [...players.values()].filter((p) => removedTeams.has(p.teamId))
  if (cascaded.length > 0) {
    for (const p of cascaded) players.delete(p.playerId)
    notes.push(
      `${cascaded.length} player(s) were dropped with their team: ` +
        `${cascaded.map((p) => p.nick).join(", ")}.`,
    )
  }

  // Added players have no sample matrix, and there is no way to give them one
  // short of a re-crawl. They are reported here and skipped by `unitsOf`, which
  // already refuses a unit whose members have no samples -- so the failure mode
  // is an absent option rather than a unit scored as though it played no games.
  const measured = new Set(published.playerSamples.map((s) => s.playerId))
  const unmeasured = [...players.values()].filter((p) => !measured.has(p.playerId))
  if (unmeasured.length > 0) {
    notes.push(
      `${unmeasured.length} player(s) have no sample matrix in this run and cannot be ` +
        `ranked until the next crawl: ${unmeasured.map((p) => p.nick).join(", ")}. ` +
        `They are absent from the pickers rather than scored as zero.`,
    )
  }

  return {
    teams: [...teams.values()].sort((a, b) => a.teamId - b.teamId),
    players: [...players.values()].sort((a, b) => a.playerId - b.playerId),
  }
}

// ---------------------------------------------------------------------------
// emblems
// ---------------------------------------------------------------------------

/**
 * The full generatable catalog: every stat x tier x trait.
 *
 * Regenerated rather than patched, because the catalog is not an input -- it is
 * the cross product of three tables the overlay can move, and an emblem list
 * edited beside them is a second source of truth that disagrees the moment
 * either side changes. Add a tier and every stat gains a row; remove a stat and
 * every emblem carrying it goes with it. That is the correct behaviour and it
 * is only correct if nobody can edit the product directly.
 *
 * This IS a second implementation of `build_emblems` in engine/scripts/publish.py,
 * which is the kind of duplication CLAUDE.md says drifts silently. The guard is
 * `server/test/overlay.test.ts`, which regenerates the catalog from an
 * unmodified run's own scoring table and asserts it reproduces that run's
 * `emblems` exactly -- so the day the publisher's generator changes, this one
 * fails rather than quietly producing ids the client cannot resolve.
 */
export function buildEmblems(scoring: Scoring, tournamentId: string, stage: string): Emblem[] {
  const out: Emblem[] = []
  for (const stat of Object.keys(scoring.stats).sort()) {
    const spec = scoring.stats[stat]!
    for (const tier of Object.keys(scoring.quality)) {
      for (const trait of Object.keys(scoring.traits)) {
        out.push({
          emblemId: `${stat}:${tier}:${trait}`,
          tournamentId,
          stage: stage as Emblem["stage"],
          stat,
          tier,
          trait,
          displayName: `${titleCase(stat.replace(/_/g, " "))} ${tier.replace(/^tier_/, "").toUpperCase()} ${titleCase(trait)}`,
          measurable: spec.measurable,
        })
      }
    }
  }
  return out
}

/** Python's `str.title()`, which is what the publisher's `displayName` uses.
 * Not a locale-aware or apostrophe-aware title caser: matching the publisher
 * exactly is the requirement, and any improvement here is a drift. */
function titleCase(value: string): string {
  return value.replace(/[A-Za-z]+/g, (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase())
}

// ---------------------------------------------------------------------------
// the checks JSON Schema cannot make
// ---------------------------------------------------------------------------

/**
 * Everything that is wrong with this overlay, rather than the first thing.
 *
 * Each of these is a way to produce a confidently wrong number, and each is
 * invisible once it has happened: a stat whose `source` names no column reads
 * as a stat that pays its flat base on every game; a `measurable: true` on a
 * column that does not exist is a measurement claim nobody can support; a slot
 * colour no stat carries is a picker that silently offers nothing.
 */
function assertAppliable(
  published: RunPayload,
  patched: RunPayload,
  doc: ConfigOverlay,
  notes: string[],
): void {
  const reasons: string[] = []
  const { scoring } = patched

  // The columns this run actually carries. Not a guess and not configurable:
  // the publisher writes one column list and every player's matrix uses it.
  const columns = new Set(published.playerSamples[0]?.stats ?? [])
  const palette = new Set(scoring.colors)

  if (Object.keys(scoring.stats).length === 0) reasons.push("no stats are left; nothing can score.")
  if (Object.keys(scoring.quality).length === 0) {
    reasons.push("no emblem tiers are left; the emblem catalog would be empty.")
  }
  if (Object.keys(scoring.traits).length === 0) {
    reasons.push("no emblem traits are left; the emblem catalog would be empty.")
  }

  for (const [key, spec] of Object.entries(scoring.stats)) {
    const isNew = !(key in published.scoring.stats)
    const patch = doc.scoring?.stats?.[key]
    if (isNew && patch) {
      for (const field of ["perUnit", "base", "color", "measurable"] as const) {
        if (patch[field] === undefined) {
          reasons.push(
            `new stat "${key}" does not set ${field}. A stat the run does not already ` +
              `carry has nothing to merge onto, and a defaulted field here is a value ` +
              `nobody chose.`,
          )
        }
      }
      if (patch.source === undefined) {
        reasons.push(
          `new stat "${key}" does not set source. It must name the playerSamples column ` +
            `carrying its per-game values, or null for a stat nothing measures.`,
        )
      }
    }

    if (!palette.has(spec.color)) {
      reasons.push(
        `stat "${key}" is colour "${spec.color}", which the palette does not list ` +
          `(${[...palette].join(", ")}). No slot could hold it.`,
      )
    }

    if (spec.source !== null && spec.source !== undefined && !columns.has(spec.source)) {
      reasons.push(
        `stat "${key}" names source column "${spec.source}", which this run does not ` +
          `carry. Available: ${[...columns].sort().join(", ")}. A source that does not ` +
          `exist is not an error at scoring time -- the stat silently pays its flat base ` +
          `on every game and nothing downstream can tell.`,
      )
    }

    if (spec.measurable && (spec.source === null || spec.source === undefined)) {
      reasons.push(
        `stat "${key}" is marked measurable with no source column. That is a measurement ` +
          `claim with nothing behind it: set a source, or mark it unmeasurable so the ` +
          `tool excludes it from emblem choice instead of valuing it at its base.`,
      )
    }
  }

  // Collected rather than reported per trait: a run published before the field
  // existed carries five of them, and five copies of one sentence is a wall a
  // reader skips rather than a caveat they read.
  const legacyTraits: string[] = []
  for (const [name, spec] of Object.entries(scoring.traits)) {
    const rule = spec.conditionRule
    // Only for a trait this overlay ADDS or EDITS. Every run published before
    // `conditionRule` existed carries five traits without one, and the scorer
    // resolves those by name -- correct for exactly those five. Refusing them
    // here would mean no overlay could be published against any existing run at
    // all, which is a rule that fires on every correct use and none of the
    // dangerous ones.
    const touched = doc.scoring?.traits?.[name] !== undefined
    const isNew = !(name in published.scoring.traits)
    if ((rule === null || rule === undefined) && (touched || isNew)) {
      reasons.push(
        `trait "${name}" names no conditionRule. A trait with no rule is scored as ` +
          `paying nothing, which is the safe direction and almost certainly not what ` +
          `was meant -- name "always" if it is unconditional.`,
      )
    } else if (rule === null || rule === undefined) {
      legacyTraits.push(name)
    }
    if (spec.adjacentBonus !== 0 && rule === "always" && spec.bonus === 0) {
      notes.push(
        `Trait "${name}" pays only its neighbours. "neighboursOnly" states that more ` +
          `plainly than "always" with a zero bonus.`,
      )
    }
  }

  if (legacyTraits.length > 0) {
    notes.push(
      `${legacyTraits.length} trait(s) carry no condition rule, because this run was ` +
        `published before traits named their own: ${legacyTraits.join(", ")}. They are ` +
        `scored by matching the trait's NAME, which is right for the five the TI 2026 ` +
        `client shipped and right for nothing else. Republish with publish.py to retire ` +
        `the fallback.`,
    )
  }

  // A slot colour nothing can fill. The target search enumerates candidates per
  // slot from the stats of that slot's colour, so an empty one is a slot with no
  // legal emblem -- and the search returns fewer answers rather than an error.
  const byColor = new Map<string, { total: number; measurable: number }>()
  for (const spec of Object.values(scoring.stats)) {
    const seen = byColor.get(spec.color) ?? { total: 0, measurable: 0 }
    seen.total += 1
    if (spec.measurable) seen.measurable += 1
    byColor.set(spec.color, seen)
  }
  for (const [role, row] of Object.entries(scoring.bannerColors ?? {})) {
    row.forEach((color, slot) => {
      const seen = byColor.get(color)
      if (!seen || seen.total === 0) {
        reasons.push(
          `${role} slot ${slot + 1} is colour "${color}", which no stat carries. ` +
            `That slot could never be filled.`,
        )
      } else if (seen.measurable === 0) {
        notes.push(
          `${role} slot ${slot + 1} is colour "${color}", whose stats are all ` +
            `unmeasurable. The target search will decline that slot rather than ` +
            `recommend an emblem it cannot value.`,
        )
      }
    })
  }

  // Roster completeness. A patch onto an id the run does not carry is an
  // addition, and an addition missing a required field would otherwise merge
  // onto defaults and look deliberate.
  const teamIds = new Set(patched.teams.map((t) => t.teamId))
  for (const [key, patch] of Object.entries(doc.teams ?? {})) {
    if (published.teams.some((t) => t.teamId === Number(key))) continue
    if (!patch.name) reasons.push(`new team ${key} has no name.`)
  }
  for (const [key, patch] of Object.entries(doc.players ?? {})) {
    const isNew = !published.players.some((p) => p.playerId === Number(key))
    if (isNew) {
      for (const field of ["nick", "teamId", "fantasyRole", "lane"] as const) {
        if (patch[field] === undefined) reasons.push(`new player ${key} does not set ${field}.`)
      }
    }
  }
  for (const player of patched.players) {
    if (!teamIds.has(player.teamId)) {
      reasons.push(
        `player "${player.nick}" (${player.playerId}) is on team ${player.teamId}, which ` +
          `is not in this run. A player on no team cannot be ranked.`,
      )
    }
  }

  const catalog =
    Object.keys(scoring.stats).length *
    Object.keys(scoring.quality).length *
    Object.keys(scoring.traits).length
  if (catalog > MAX_CATALOG) {
    reasons.push(
      `this overlay generates ${catalog.toLocaleString()} emblems ` +
        `(${Object.keys(scoring.stats).length} stats x ` +
        `${Object.keys(scoring.quality).length} tiers x ` +
        `${Object.keys(scoring.traits).length} traits), over the ${MAX_CATALOG.toLocaleString()} ` +
        `this server will search. The banner search prices every legal candidate per slot, ` +
        `so past this bound the tool answers slowly rather than wrongly -- but it answers ` +
        `too slowly to use.`,
    )
  }

  if (reasons.length > 0) throw new OverlayRejected(reasons)
}

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------

/** Entities this overlay moves. The count a reader sees beside "overrides
 * active", so it counts things a reader would name -- one stat, one team -- and
 * not fields within them. */
export function countChanges(doc: ConfigOverlay): number {
  const s = doc.scoring ?? {}
  return (
    Object.keys(s.stats ?? {}).length +
    (s.statsRemoved ?? []).length +
    Object.keys(s.quality ?? {}).length +
    (s.qualityRemoved ?? []).length +
    Object.keys(s.traits ?? {}).length +
    (s.traitsRemoved ?? []).length +
    (s.colors ? 1 : 0) +
    Object.keys(s.bannerColors ?? {}).length +
    Object.keys(doc.teams ?? {}).length +
    (doc.teamsRemoved ?? []).length +
    Object.keys(doc.players ?? {}).length +
    (doc.playersRemoved ?? []).length
  )
}

/**
 * Overlay entries that now say exactly what the published run already says.
 *
 * The drift this feature would otherwise create: an overlay corrects a stat, a
 * later crawl publishes a run that carries the correction, and the overlay stays
 * on top of it forever -- silently, since it changes nothing. Until the day
 * somebody publishes a run where that value is deliberately different, and the
 * stale overlay quietly reverts it.
 *
 * So the admin page shows these as safe to drop, and says why. This is the
 * mechanism that keeps the YAML and the overlay from becoming two rival sources
 * of truth: an overlay is meant to be temporary, and this is how it retires.
 */
export function redundantEntries(published: RunPayload, doc: ConfigOverlay): string[] {
  const out: string[] = []
  const base = published.scoring

  for (const [key, patch] of Object.entries(doc.scoring?.stats ?? {})) {
    const spec = base.stats[key]
    if (!spec) continue
    const same = (Object.entries(patch) as [keyof typeof patch, unknown][]).every(
      ([field, value]) => (spec as Record<string, unknown>)[field] === value,
    )
    if (same) out.push(`scoring.stats.${key}`)
  }
  for (const [key, bonus] of Object.entries(doc.scoring?.quality ?? {})) {
    if (base.quality[key] === bonus) out.push(`scoring.quality.${key}`)
  }
  for (const [key, patch] of Object.entries(doc.scoring?.traits ?? {})) {
    const spec = base.traits[key]
    if (!spec) continue
    const same = (Object.entries(patch) as [keyof typeof patch, unknown][]).every(
      ([field, value]) => (spec as Record<string, unknown>)[field] === value,
    )
    if (same) out.push(`scoring.traits.${key}`)
  }
  for (const key of doc.scoring?.statsRemoved ?? []) {
    if (!(key in base.stats)) out.push(`scoring.statsRemoved.${key}`)
  }
  for (const key of doc.scoring?.qualityRemoved ?? []) {
    if (!(key in base.quality)) out.push(`scoring.qualityRemoved.${key}`)
  }
  for (const key of doc.scoring?.traitsRemoved ?? []) {
    if (!(key in base.traits)) out.push(`scoring.traitsRemoved.${key}`)
  }

  const teams = new Map(
    published.teams.map((t) => [t.teamId, t as unknown as Record<string, unknown>]),
  )
  for (const [key, patch] of Object.entries(doc.teams ?? {})) {
    const team = teams.get(Number(key))
    if (!team) continue
    const same = Object.entries(patch).every(([field, value]) =>
      Array.isArray(value)
        ? JSON.stringify(team[field]) === JSON.stringify(value)
        : team[field] === value,
    )
    if (same) out.push(`teams.${key}`)
  }
  const players = new Map(
    published.players.map((p) => [p.playerId, p as unknown as Record<string, unknown>]),
  )
  for (const [key, patch] of Object.entries(doc.players ?? {})) {
    const player = players.get(Number(key))
    if (!player) continue
    if (Object.entries(patch).every(([field, value]) => player[field] === value)) {
      out.push(`players.${key}`)
    }
  }

  return out
}

export type { ConfigOverlay }
