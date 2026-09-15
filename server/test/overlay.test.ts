import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

import {
  applyOverlay,
  buildEmblems,
  countChanges,
  EMPTY_OVERLAY,
  OverlayRejected,
  redundantEntries,
  validateOverlay,
} from "../src/admin/overlay.js"
import { multipliers } from "../src/scoring/banner.js"
import type { ConfigOverlay } from "../../shared/overlay-types.js"
import type { Emblem, RunPayload, Scoring } from "../src/validate.js"

/**
 * These pin the traps, not the arithmetic.
 *
 * An admin form over the scoring table is the most direct route this project
 * has ever had to a confidently wrong number, so every test below targets one
 * specific way an edit could look accepted and score nonsense:
 *
 *  - a stat naming a source column the run does not carry, which does not error
 *    at scoring time -- it silently pays the stat's flat base on every game
 *  - `measurable: true` with nothing behind it, which is a measurement claim
 *  - a banner slot whose colour no stat carries, which empties a picker
 *  - an emblem catalog that drifts from the publisher's, so ids stop resolving
 *  - a trait with no rule, which would otherwise pay on every banner
 *  - an overlay that goes stale against a newer run and reverts a value
 */

const b64 = (bytes: number) => Buffer.alloc(bytes).toString("base64")

/**
 * A payload shaped like a real one, small enough to reason about.
 *
 * Three stats, two tiers, two traits -- so the emblem catalog is exactly twelve
 * rows and a change to any axis is countable by hand. TWO red stats rather than
 * one, deliberately: with a single stat per colour, removing any stat also
 * empties a banner slot, and every removal test would pass for the wrong
 * reason. Two teams for the same kind of reason -- the run contract requires at
 * least one of each, so a fixture with one team cannot tell "removing a team
 * cascades to its players" apart from "the payload went empty".
 */
function payload(): RunPayload {
  const stats = ["smokes_used", "kills", "deaths"]
  const nGames = 2
  const nShapeSamples = 2
  const maxSeries = 3

  return {
    run: {
      runId: "r1",
      tournamentId: "ti2026",
      stage: "main",
      bannerSlots: 5,
      schemaVersion: 1,
      createdAt: "2026-08-20T00:00:00.000Z",
      engineVersion: "abc1234",
      configHash: "deadbeef",
      params: {
        statHalfLife: 60,
        ratingHalfLife: 90,
        asOf: "2026-08-20T00:00:00.000Z",
        l2Prior: 3,
        patchStrength: 1,
        sims: 20000,
      },
      dataWindow: { from: "2026-02-20T00:00:00.000Z", to: "2026-08-19T00:00:00.000Z", matchCount: 833 },
      gatesForced: [],
      isCurrent: true,
    },
    scoring: {
      version: "ti2026-client",
      verifiedAgainstClient: true,
      colors: ["red", "blue"],
      bannerColors: { core: ["red", "blue", "red", "blue", "red"] },
      stats: {
        smokes_used: { perUnit: 293, base: 0, color: "blue", measurable: true, source: "smokes_used" },
        kills: { perUnit: 107, base: 0, color: "red", measurable: true, source: "kills" },
        deaths: { perUnit: -195, base: 1950, color: "red", measurable: true, source: "deaths" },
      },
      quality: { tier_ii: 0.3, tier_iv: 1.0 },
      traits: {
        friendly: { bonus: 0.5, adjacentBonus: 0, condition: "at least 3", conditionRule: "countAtLeast3" },
        vampiric: { bonus: 0.5, adjacentBonus: -0.1, condition: null, conditionRule: "always" },
      },
    },
    teams: [
      { teamId: 1, tournamentId: "ti2026", name: "Team Spirit", alsoTeamIds: [] },
      { teamId: 2, tournamentId: "ti2026", name: "PARIVISION", alsoTeamIds: [9824702] },
    ],
    players: [
      { playerId: 10, tournamentId: "ti2026", nick: "Rue", teamId: 1, fantasyRole: "support", lane: "hard_support" },
      { playerId: 20, tournamentId: "ti2026", nick: "Kiritych", teamId: 2, fantasyRole: "core", lane: "carry" },
    ],
    emblems: [
      {
        emblemId: "kills:tier_ii:friendly",
        tournamentId: "ti2026",
        stage: "main",
        stat: "kills",
        tier: "tier_ii",
        trait: "friendly",
        displayName: "Kills II Friendly",
        measurable: true,
      },
    ],
    playerSamples: [
      {
        runId: "r1",
        playerId: 10,
        stats: stats as [string, ...string[]],
        games: b64(nGames * stats.length * 4),
        nGames,
        matchId: b64(nGames * 8),
        heroId: b64(nGames * 4),
        won: b64(nGames),
        durationSeconds: b64(nGames * 4),
        firstBloodTime: b64(nGames * 4),
        startTime: b64(nGames * 8),
        gameWeight: b64(nGames * 4),
        sampleWarnings: [],
      },
    ],
    stageProjections: [
      {
        runId: "r1",
        teamId: 1,
        stage: "main",
        bracket: { placementProbs: { "1st": 0.27 }, winProb: 0.27 },
        seriesSamples: b64(nShapeSamples * maxSeries),
        deciderSamples: b64(nShapeSamples * maxSeries),
        nSims: 20000,
        nShapeSamples,
        maxSeries,
        expectedSeries: 3.6,
        eliminationRisk: 0.24,
      },
    ],
    factorAudit: [],
  } as RunPayload
}

const overlay = (doc: Partial<ConfigOverlay>): ConfigOverlay =>
  ({ schemaVersion: 1, ...doc }) as ConfigOverlay

// ---------------------------------------------------------------------------
// the empty case
// ---------------------------------------------------------------------------

test("an empty overlay changes the scoring table not at all", () => {
  const published = payload()
  const { payload: out, changeCount } = applyOverlay(published, EMPTY_OVERLAY)
  assert.equal(changeCount, 0)
  assert.deepEqual(out.scoring.stats, published.scoring.stats)
  assert.deepEqual(out.teams, published.teams)
  assert.deepEqual(out.players, published.players)
})

test("applying never mutates the published payload", () => {
  // The published run is one object shared by every request for the life of the
  // process. A mutation here would rewrite it for everyone, permanently, from
  // one admin's draft preview -- and nothing downstream could tell.
  const published = payload()
  const before = JSON.stringify(published)
  applyOverlay(published, overlay({ scoring: { stats: { kills: { perUnit: 999 } } } }))
  assert.equal(JSON.stringify(published), before)
})

// ---------------------------------------------------------------------------
// the emblem catalog
// ---------------------------------------------------------------------------

test("the catalog is regenerated, so a new tier reaches every stat and trait", () => {
  const published = payload() // 3 stats x 2 tiers x 2 traits
  const { payload: out } = applyOverlay(
    published,
    overlay({ scoring: { quality: { tier_v: 1.5 } } }),
  )
  assert.equal(out.emblems.length, 3 * 3 * 2)
  assert.ok(out.emblems.some((e) => e.emblemId === "kills:tier_v:vampiric"))
})

test("removing a stat removes every emblem that carried it", () => {
  const { payload: out } = applyOverlay(
    payload(),
    overlay({ scoring: { statsRemoved: ["kills"] } }),
  )
  assert.equal(out.emblems.length, 2 * 2 * 2)
  assert.ok(!out.emblems.some((e) => e.stat === "kills"))
})

test("displayName matches the publisher's format exactly", () => {
  // The id is what the client sends back and the server resolves, and the name
  // is what a reader matches against their client. Both are produced HERE and in
  // engine/scripts/publish.py, and the two drifting is silent: ids stop
  // resolving, or a name reads differently from the emblem it describes.
  const emblems = buildEmblems(payload().scoring, "ti2026", "main")
  const one = emblems.find((e) => e.emblemId === "smokes_used:tier_iv:vampiric")
  assert.ok(one)
  assert.equal(one.displayName, "Smokes Used IV Vampiric")
})

/**
 * The real drift guard.
 *
 * `run-main.json` is a dry-run publish artefact and is gitignored, so this
 * cannot be a fixture -- but on any machine that has published a run it is the
 * only thing that can prove this generator and publish.py's agree. Regenerating
 * the catalog from that run's OWN scoring table must reproduce that run's
 * emblems, row for row.
 *
 * Skipped with a reason rather than silently when the file is absent: a guard
 * that quietly does not run is worse than no guard, because it reads as a pass.
 */
test("the regenerated catalog reproduces a real published run's, row for row", (t) => {
  const path = fileURLToPath(new URL("../../run-main.json", import.meta.url))
  if (!existsSync(path)) {
    t.skip(
      "no run-main.json here (it is a gitignored publish artefact). " +
        "Run `python -m scripts.publish --out ../run-main.json` from engine/ to arm this.",
    )
    return
  }

  const real = JSON.parse(readFileSync(path, "utf8")) as RunPayload
  const regenerated = buildEmblems(real.scoring, real.run.tournamentId, real.run.stage)

  const key = (e: Emblem) => `${e.emblemId}|${e.displayName}|${e.measurable}`
  assert.deepEqual(
    regenerated.map(key).sort(),
    real.emblems.map(key).sort(),
    "the server's emblem generator has drifted from engine/scripts/publish.py",
  )
})

// ---------------------------------------------------------------------------
// the silent ways to be wrong
// ---------------------------------------------------------------------------

test("a stat naming a source column the run does not carry is refused", () => {
  // The whole reason this check exists: nothing downstream errors. `statValues`
  // finds no column, falls through to the stat's flat base, and every game
  // scores the same plausible number.
  assert.throws(
    () =>
      applyOverlay(
        payload(),
        overlay({
          scoring: {
            stats: {
              lotuses_grabbed: {
                perUnit: 176,
                base: 0,
                color: "blue",
                measurable: true,
                source: "lotuses_grabbed",
              },
            },
          },
        }),
      ),
    (err: unknown) =>
      err instanceof OverlayRejected &&
      err.reasons.some((r) => r.includes("does not carry") && r.includes("flat base")),
  )
})

test("measurable with no source is refused as a claim with nothing behind it", () => {
  assert.throws(
    () =>
      applyOverlay(
        payload(),
        overlay({ scoring: { stats: { smokes_used: { measurable: true, source: null } } } }),
      ),
    (err: unknown) =>
      err instanceof OverlayRejected && err.reasons.some((r) => r.includes("measurement claim")),
  )
})

test("a new stat must name every field rather than merging onto defaults", () => {
  assert.throws(
    () => applyOverlay(payload(), overlay({ scoring: { stats: { courier_kills: { perUnit: 703 } } } })),
    (err: unknown) =>
      err instanceof OverlayRejected &&
      err.reasons.some((r) => r.includes("does not set color")) &&
      err.reasons.some((r) => r.includes("does not set source")),
  )
})

test("a slot colour no stat carries is refused", () => {
  assert.throws(
    () =>
      applyOverlay(
        payload(),
        overlay({ scoring: { bannerColors: { core: ["green", "blue", "red", "blue", "red"] } } }),
      ),
    (err: unknown) =>
      err instanceof OverlayRejected &&
      err.reasons.some((r) => r.includes("could never be filled")),
  )
})

test("a slot whose stats are all unmeasurable is a note, not a refusal", () => {
  // Different from the case above: the slot CAN be filled, the tool just cannot
  // value what fills it. That is a caveat the reader is owed, not a broken run.
  const { notes } = applyOverlay(
    payload(),
    overlay({
      scoring: {
        stats: {
          kills: { measurable: false, source: null },
          deaths: { measurable: false, source: null },
        },
      },
    }),
  )
  assert.ok(notes.some((n) => n.includes("unmeasurable")))
})

test("a trait with no conditionRule is refused", () => {
  // Left to itself this is the worst one on the list: the trait pays its bonus
  // on every banner, every score moves up, and nothing looks broken.
  assert.throws(
    () =>
      applyOverlay(
        payload(),
        overlay({
          scoring: { traits: { voracious: { bonus: 0.4, adjacentBonus: 0, conditionRule: null } } },
        }),
      ),
    (err: unknown) =>
      err instanceof OverlayRejected && err.reasons.some((r) => r.includes("conditionRule")),
  )
})

test("an added trait's rule is obeyed by the scorer, not its name", () => {
  const { payload: out } = applyOverlay(
    payload(),
    overlay({
      scoring: {
        traits: { voracious: { bonus: 0.4, adjacentBonus: 0, conditionRule: "onlyOne" } },
      },
    }),
  )
  const emblem = (tier: string, trait: string): Emblem =>
    out.emblems.find((e) => e.stat === "kills" && e.tier === tier && e.trait === trait)!

  // One Voracious on the banner: the rule fires.
  const alone = multipliers([emblem("tier_ii", "voracious"), emblem("tier_iv", "friendly")], out.scoring)
  assert.equal(round(alone[0]!), round(1 + 0.3 + 0.4))

  // Two: it does not. A name switch would have paid both.
  const pair = multipliers(
    [emblem("tier_ii", "voracious"), emblem("tier_iv", "voracious")],
    out.scoring,
  )
  assert.equal(round(pair[0]!), round(1 + 0.3))
})

test("a run published before conditionRule still fires the five client traits", () => {
  // Every run published so far carries no `conditionRule`, so `legacyRule` is
  // load-bearing for all of them until they age out. It is correct for exactly
  // the five traits the TI 2026 client shipped, which is what this pins.
  const legacy = payload()
  legacy.scoring.traits = {
    fractal: { bonus: 0.6, adjacentBonus: 0, condition: null },
    friendly: { bonus: 0.5, adjacentBonus: 0, condition: null },
  } as unknown as typeof legacy.scoring.traits

  const { payload: out } = applyOverlay(legacy, EMPTY_OVERLAY)
  const emblem = (tier: string, trait: string): Emblem =>
    out.emblems.find((e) => e.stat === "kills" && e.tier === tier && e.trait === trait)!

  // Fractal fires only when every tier differs.
  const differing = multipliers(
    [emblem("tier_ii", "fractal"), emblem("tier_iv", "friendly")],
    out.scoring,
  )
  assert.equal(round(differing[0]!), round(1 + 0.3 + 0.6))

  const matching = multipliers(
    [emblem("tier_ii", "fractal"), emblem("tier_ii", "friendly")],
    out.scoring,
  )
  assert.equal(round(matching[0]!), round(1 + 0.3))

  // Friendly needs three of itself, and two is not three.
  assert.equal(round(differing[1]!), round(1 + 1.0))
})

test("a trait the legacy fallback does not know pays nothing, not everything", () => {
  // The direction matters. Understating a banner is noticed by whoever compares
  // it to their client; overstating it by paying an unknown trait
  // unconditionally raises every score at once and looks like nothing at all.
  const legacy = payload()
  legacy.scoring.traits = {
    voracious: { bonus: 0.9, adjacentBonus: 0, condition: null },
  } as unknown as typeof legacy.scoring.traits

  const { payload: out } = applyOverlay(legacy, EMPTY_OVERLAY)
  const only = out.emblems.find((e) => e.stat === "kills" && e.tier === "tier_ii")!
  assert.equal(round(multipliers([only], out.scoring)[0]!), round(1 + 0.3))
})

test("a catalog past the search bound is refused with the multiplication shown", () => {
  const tiers: Record<string, number> = {}
  for (let i = 0; i < 50; i++) tiers[`tier_${i}`] = 0.1
  const traits: Record<string, { bonus: number; adjacentBonus: number; conditionRule: "always" }> = {}
  for (let i = 0; i < 50; i++) traits[`t${i}`] = { bonus: 0.1, adjacentBonus: 0, conditionRule: "always" }

  assert.throws(
    () => applyOverlay(payload(), overlay({ scoring: { quality: tiers, traits } })),
    (err: unknown) => err instanceof OverlayRejected && err.reasons.some((r) => r.includes("emblems")),
  )
})

// ---------------------------------------------------------------------------
// roster
// ---------------------------------------------------------------------------

test("an added player is reported as unmeasured rather than scored as zero", () => {
  const { payload: out, notes } = applyOverlay(
    payload(),
    overlay({
      players: {
        "77": { nick: "Standin", teamId: 1, fantasyRole: "mid", lane: "mid" },
      },
    }),
  )
  assert.ok(out.players.some((p) => p.playerId === 77))
  assert.ok(notes.some((n) => n.includes("no sample matrix") && n.includes("Standin")))
})

test("a player on a team that does not exist is refused", () => {
  assert.throws(
    () =>
      applyOverlay(
        payload(),
        overlay({ players: { "77": { nick: "Ghost", teamId: 999, fantasyRole: "mid", lane: "mid" } } }),
      ),
    (err: unknown) =>
      err instanceof OverlayRejected && err.reasons.some((r) => r.includes("cannot be ranked")),
  )
})

test("removing a team takes its players with it, and says so", () => {
  const { payload: out, notes } = applyOverlay(payload(), overlay({ teamsRemoved: ["2"] }))
  assert.deepEqual(
    out.players.map((p) => p.playerId),
    [10],
  )
  assert.ok(notes.some((n) => n.includes("dropped with their team") && n.includes("Kiritych")))
})

test("a player left orphaned by a typo is refused, not quietly dropped", () => {
  // The distinction the cascade above must not swallow. Removing a team is a
  // decision; pointing a player at an id that was never a team is a mistake,
  // and dropping them for it would make "I added a player and nothing
  // happened" the answer.
  assert.throws(
    () => applyOverlay(payload(), overlay({ players: { "20": { teamId: 999 } } })),
    (err: unknown) =>
      err instanceof OverlayRejected && err.reasons.some((r) => r.includes("cannot be ranked")),
  )
})

test("a partial team patch leaves the fields it does not name", () => {
  const { payload: out } = applyOverlay(payload(), overlay({ teams: { "1": { tag: "TS" } } }))
  const team = out.teams.find((t) => t.teamId === 1)!
  assert.equal(team.name, "Team Spirit")
  assert.equal(team.tag, "TS")
})

// ---------------------------------------------------------------------------
// staleness
// ---------------------------------------------------------------------------

test("entries that now agree with the published run are reported as redundant", () => {
  // This is how an overlay retires. Without it, a correction that a later crawl
  // carried into the run stays on top of it forever -- invisible, because it
  // changes nothing, until a run deliberately sets that value differently and
  // the forgotten overlay puts the old one back.
  const published = payload()
  const doc = overlay({
    scoring: { stats: { kills: { perUnit: 107 } }, quality: { tier_ii: 0.3 } },
    teams: { "1": { name: "Team Spirit" } },
  })
  assert.deepEqual(redundantEntries(published, doc).sort(), [
    "scoring.quality.tier_ii",
    "scoring.stats.kills",
    "teams.1",
  ])
})

test("an overlay that no longer applies is a rejection, never a half-application", () => {
  // The realistic staleness path: the overlay renames a stat's source, then a
  // new run is published whose sample matrices no longer carry that column.
  const stale = payload()
  stale.playerSamples[0]!.stats = ["kills"] as [string, ...string[]]
  stale.playerSamples[0]!.games = b64(2 * 1 * 4)

  assert.throws(
    () =>
      applyOverlay(
        stale,
        overlay({ scoring: { stats: { smokes_used: { perUnit: 300 } } } }),
      ),
    OverlayRejected,
  )
})

// ---------------------------------------------------------------------------
// shape
// ---------------------------------------------------------------------------

test("an unknown top-level key is refused rather than ignored", () => {
  // Ignoring it would mean an admin's edit silently doing nothing, which is the
  // one failure an editing UI must never have.
  assert.throws(
    () => validateOverlay({ schemaVersion: 1, playerSamples: [] }),
    OverlayRejected,
  )
})

test("a bonus outside the guard rail is refused", () => {
  assert.throws(
    () => validateOverlay({ schemaVersion: 1, scoring: { quality: { tier_v: 150 } } }),
    OverlayRejected,
  )
})

test("changeCount counts entities a reader would name", () => {
  assert.equal(
    countChanges(
      overlay({
        scoring: { stats: { kills: { perUnit: 1 } }, qualityRemoved: ["tier_ii"] },
        teams: { "1": { tag: "TS" } },
      }),
    ),
    3,
  )
})

const round = (v: number) => Math.round(v * 1e6) / 1e6
