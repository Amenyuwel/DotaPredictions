import assert from "node:assert/strict"
import { test } from "node:test"

import { assertRunPayload, SchemaMismatch } from "../src/validate.js"

/**
 * These pin the one behaviour the server must never soften: a payload that does
 * not match the contract stops the process instead of being served.
 *
 * Both failures tested here are silent by nature. A missing field is caught by
 * the schema; a base64 blob of the WRONG LENGTH is not -- it is a valid string,
 * and it decodes into a Float32Array of plausible garbage with every column
 * shifted. That second case is the reason byte lengths are asserted at all.
 */

const b64 = (bytes: number) => Buffer.alloc(bytes).toString("base64")

function validPayload() {
  const nGames = 2
  const stats = ["kills", "deaths"]
  const nShapeSamples = 2
  const maxSeries = 3

  return {
    run: {
      runId: "r1",
      tournamentId: "ti2026",
      stage: "main",
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
      dataWindow: {
        from: "2026-02-20T00:00:00.000Z",
        to: "2026-08-19T00:00:00.000Z",
        matchCount: 833,
      },
      gatesForced: [],
      isCurrent: true,
    },
    scoring: {
      version: "ti2026-client",
      verifiedAgainstClient: true,
      colors: ["red", "blue", "green"],
      stats: {
        smokes_used: { perUnit: 293, base: 0, color: "blue", measurable: true, source: "smokes_used" },
        lotuses_grabbed: { perUnit: 176, base: 0, color: "blue", measurable: false, source: null },
      },
      quality: { tier_ii: 0.3, tier_iv: 1.0 },
      traits: {
        friendly: { bonus: 0.5, adjacentBonus: 0, condition: "at least 3 Friendly" },
        vampiric: { bonus: 0.5, adjacentBonus: -0.1, condition: null },
      },
    },
    teams: [{ teamId: 1, tournamentId: "ti2026", name: "Team Spirit", alsoTeamIds: [] }],
    players: [
      {
        playerId: 10,
        tournamentId: "ti2026",
        nick: "Rue",
        teamId: 1,
        fantasyRole: "support",
        lane: "hard_support",
      },
    ],
    emblems: [
      {
        emblemId: "e1",
        tournamentId: "ti2026",
        stage: "main",
        stat: "smokes_used",
        tier: "tier_iv",
        trait: "friendly",
        displayName: "Smokes Used IV Friendly",
        measurable: true,
      },
    ],
    playerSamples: [
      {
        runId: "r1",
        playerId: 10,
        stats,
        games: b64(nGames * stats.length * 4),
        nGames,
        matchId: b64(nGames * 8),
        heroId: b64(nGames * 4),
        won: b64(nGames * 1),
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
    factorAudit: [
      { runId: "r1", factor: "coach_titles", kind: "data", delta: 0.061, verdict: "keep" },
    ],
  }
}

test("a well-formed payload validates", () => {
  assert.doesNotThrow(() => assertRunPayload(validPayload()))
})

test("a missing required field throws rather than loading", () => {
  const payload = validPayload() as Record<string, any>
  delete payload.run.params.statHalfLife
  assert.throws(() => assertRunPayload(payload), SchemaMismatch)
})

test("nGames disagreeing with the games matrix throws", () => {
  // The silent one: still a valid base64 string, still the right type, and it
  // would decode into a matrix with every column shifted by one game.
  const payload = validPayload() as Record<string, any>
  payload.playerSamples[0].nGames = 3
  assert.throws(
    () => assertRunPayload(payload),
    (err: unknown) =>
      err instanceof SchemaMismatch && err.message.includes("expected 24"),
  )
})

test("a per-game scalar of the wrong length throws", () => {
  const payload = validPayload() as Record<string, any>
  payload.playerSamples[0].matchId = b64(4) // one row short
  assert.throws(
    () => assertRunPayload(payload),
    (err: unknown) => err instanceof SchemaMismatch && err.message.includes("matchId"),
  )
})

test("series shapes that do not fill nShapeSamples x maxSeries throw", () => {
  const payload = validPayload() as Record<string, any>
  payload.stageProjections[0].maxSeries = 4
  assert.throws(
    () => assertRunPayload(payload),
    (err: unknown) => err instanceof SchemaMismatch && err.message.includes("seriesSamples"),
  )
})

test("an unknown stage is rejected, so a new format cannot arrive unnoticed", () => {
  const payload = validPayload() as Record<string, any>
  payload.run.stage = "playoffs"
  assert.throws(() => assertRunPayload(payload), SchemaMismatch)
})
