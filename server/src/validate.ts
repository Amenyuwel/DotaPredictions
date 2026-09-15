import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js"
import addFormats from "ajv-formats"

import type {
  Emblem,
  FantasyRole,
  Lane,
  Player,
  PlayerSamples,
  RunMeta,
  RunPayload,
  Scoring,
  StageProjection,
  Team,
} from "../../shared/run-types.js"

/**
 * Validation against the published contract.
 *
 * The rule this file exists to enforce: a schema mismatch must CRASH, never
 * render. Everywhere else in this project a missing input degrades into a
 * smaller sample, because less evidence is still honest evidence. A payload
 * that does not match its own schema is a different thing -- it means the writer
 * and the reader disagree about what the bytes mean, and any number computed
 * from it would be confidently wrong.
 */

const schemaPath = fileURLToPath(new URL("../../shared/run-schema.json", import.meta.url))
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats.default(ajv)

const validateRunPayload: ValidateFunction<RunPayload> = ajv.compile<RunPayload>(schema)

export class SchemaMismatch extends Error {
  readonly errors: string[]

  constructor(errors: string[]) {
    super(`run payload does not match shared/run-schema.json:\n  ${errors.join("\n  ")}`)
    this.name = "SchemaMismatch"
    this.errors = errors
  }
}

export function assertRunPayload(payload: unknown): asserts payload is RunPayload {
  if (validateRunPayload(payload)) {
    assertByteLengths(payload)
    return
  }
  const errors = (validateRunPayload.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`,
  )
  throw new SchemaMismatch(errors.length > 0 ? errors : ["unknown validation failure"])
}

/**
 * The invariants JSON Schema cannot express.
 *
 * A base64 blob of the wrong length still validates as a string, and it would
 * decode into a Float32Array of plausible-looking garbage -- silently shifted
 * columns rather than an error. These are the checks that make that loud.
 */
function assertByteLengths(payload: RunPayload): void {
  const errors: string[] = []

  for (const s of payload.playerSamples) {
    const expected = s.nGames * s.stats.length * 4
    const actual = base64Bytes(s.games)
    if (actual !== expected) {
      errors.push(
        `playerSamples[${s.playerId}].games is ${actual} bytes, expected ` +
          `${expected} (${s.nGames} games x ${s.stats.length} stats x 4)`,
      )
    }
    for (const [field, width] of PER_GAME_WIDTHS) {
      const bytes = base64Bytes(s[field])
      if (bytes !== s.nGames * width) {
        errors.push(
          `playerSamples[${s.playerId}].${field} is ${bytes} bytes, expected ${s.nGames * width}`,
        )
      }
    }
  }

  for (const p of payload.stageProjections) {
    const expected = p.nShapeSamples * p.maxSeries
    for (const field of ["seriesSamples", "deciderSamples"] as const) {
      const bytes = base64Bytes(p[field])
      if (bytes !== expected) {
        errors.push(
          `stageProjections[${p.teamId}].${field} is ${bytes} bytes, expected ${expected}`,
        )
      }
    }
  }

  if (errors.length > 0) throw new SchemaMismatch(errors)
}

/** field -> bytes per game, matching the typed array the publisher wrote. */
const PER_GAME_WIDTHS: readonly [keyof PlayerSamples & string, number][] = [
  ["matchId", 8],   // int64: Dota match ids passed 2**31
  ["heroId", 4],
  ["durationSeconds", 4],
  ["firstBloodTime", 4],
  ["startTime", 8], // int64: int32 unix seconds die in 2038
  ["gameWeight", 4],
  ["won", 1],
]

function base64Bytes(value: unknown): number {
  return typeof value === "string" ? Buffer.from(value, "base64").byteLength : -1
}

export type {
  Emblem,
  FantasyRole,
  Lane,
  Player,
  PlayerSamples,
  RunMeta,
  RunPayload,
  Scoring,
  StageProjection,
  Team,
}
