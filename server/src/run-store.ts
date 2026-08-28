import { MongoClient, type Db } from "mongodb"

import { config } from "./config.js"
import { assertRunPayload, SchemaMismatch, type RunPayload } from "./validate.js"

/**
 * The published run, held in memory.
 *
 * Loaded once at boot and never mutated, because a run is immutable by
 * definition: a correction is a new run, not an edit. Requests read this
 * object; nothing in the request path talks to Mongo, and nothing anywhere
 * talks to Python.
 */

export type StoreState =
  | { status: "ready"; payload: RunPayload; loadedAt: string }
  | { status: "empty"; reason: string }
  | { status: "unconfigured"; reason: string }

let state: StoreState = {
  status: "unconfigured",
  reason: "MONGODB_URI is not set",
}

let client: MongoClient | null = null

export const runStore = {
  get state(): StoreState {
    return state
  },
  /** The payload, or null when nothing is published. Callers must handle null:
   * "no run yet" is a state to report, not an error to throw. */
  get payload(): RunPayload | null {
    return state.status === "ready" ? state.payload : null
  },
}

/**
 * Load the current run.
 *
 * Three outcomes, deliberately distinct, because they need different answers
 * from the user:
 *
 *   unconfigured  no MONGODB_URI          -> set it
 *   empty         connected, nothing to serve -> publish a run
 *   ready         serving
 *
 * A fourth outcome is not a state: a payload that fails schema validation
 * throws and takes the process with it. Serving numbers whose meaning the
 * writer and reader disagree about is worse than serving nothing.
 */
export async function loadCurrentRun(): Promise<StoreState> {
  if (!config.mongoUri) {
    state = { status: "unconfigured", reason: "MONGODB_URI is not set" }
    return state
  }

  try {
    client ??= await MongoClient.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 5_000,
    })
  } catch (err) {
    // Unreachable database is a deployment problem, not a corrupt one. Boot and
    // say so, so the client can tell "nothing published" from "server is down".
    state = { status: "empty", reason: `cannot reach MongoDB: ${describe(err)}` }
    return state
  }

  const db = client.db(config.mongoDb)
  const payload = await readCurrentPayload(db)
  if (!payload) {
    state = {
      status: "empty",
      reason: "no run has isCurrent: true for this tournament and stage",
    }
    return state
  }

  // Throws SchemaMismatch. Not caught: see the note above.
  assertRunPayload(payload)
  state = { status: "ready", payload, loadedAt: new Date().toISOString() }
  return state
}

/** The three fields this module needs off a run document to fetch the rest.
 * The full shape is the schema's business, checked once by assertRunPayload. */
interface RunKey {
  runId: string
  tournamentId: string
  stage: string
}

async function readCurrentPayload(db: Db): Promise<unknown | null> {
  const filter: Record<string, unknown> = { isCurrent: true }
  if (config.tournamentId) filter.tournamentId = config.tournamentId
  if (config.stage) filter.stage = config.stage

  const run = await db
    .collection<RunKey>("runs")
    .findOne(filter, { sort: { createdAt: -1 }, projection: { _id: 0 } })
  if (!run) return null

  const { runId } = run
  const of = <T>(name: string) =>
    db.collection(name).find({ runId }, { projection: { _id: 0 } }).toArray() as Promise<T[]>
  const catalogue = <T>(name: string) =>
    db
      .collection(name)
      .find(
        { tournamentId: run.tournamentId, ...(name === "emblems" ? { stage: run.stage } : {}) },
        { projection: { _id: 0 } },
      )
      .toArray() as Promise<T[]>

  const [teams, players, emblems, playerSamples, stageProjections, factorAudit] =
    await Promise.all([
      catalogue("teams"),
      catalogue("players"),
      catalogue("emblems"),
      of("playerSamples"),
      of("stageProjections"),
      of("factorAudit"),
    ])

  return { run, teams, players, emblems, playerSamples, stageProjections, factorAudit }
}

export async function closeRunStore(): Promise<void> {
  await client?.close()
  client = null
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export { SchemaMismatch }
