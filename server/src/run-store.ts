import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { config } from "./config.js"
import { assertRunPayload, SchemaMismatch, type RunPayload } from "./validate.js"

/**
 * The published runs, held in memory.
 *
 * Loaded once at boot and never mutated, because a run is immutable by
 * definition: a correction is a new run, not an edit. Requests read these
 * objects; nothing in the request path talks to Supabase, and nothing anywhere
 * talks to Python.
 *
 * Plural, because a tournament has stages and they are not versions of each
 * other. A Group Stage run and a Main Event run are two different questions --
 * different field, different format, different banner size -- answered by two
 * different simulators. Holding one and calling it "current" would make the
 * other unreachable rather than merely unselected.
 */

export interface LoadedRun {
  payload: RunPayload
  loadedAt: string
}

export type StoreState =
  /** Newest first. Never empty in this state. */
  | { status: "ready"; runs: LoadedRun[] }
  | { status: "empty"; reason: string }
  | { status: "unconfigured"; reason: string }

let state: StoreState = {
  status: "unconfigured",
  reason: "neither RUN_FILE nor SUPABASE_URL is set",
}

export const runStore = {
  get state(): StoreState {
    return state
  },

  get runs(): LoadedRun[] {
    return state.status === "ready" ? state.runs : []
  },

  /**
   * The run a request means.
   *
   * Both arguments are optional and both narrow: no arguments means the newest
   * run of any stage, which is what a first page load asks for. An unmatched
   * request returns null rather than falling back to a different stage --
   * answering a Group Stage question with Main Event numbers would be a wrong
   * answer wearing the right shape.
   */
  find(tournamentId?: string, stage?: string): RunPayload | null {
    const match = runStore.runs.find(
      ({ payload }) =>
        (!tournamentId || payload.run.tournamentId === tournamentId) &&
        (!stage || payload.run.stage === stage),
    )
    return match?.payload ?? null
  },

  /** What the client can offer in a switcher. */
  get available() {
    return runStore.runs.map(({ payload }) => ({
      runId: payload.run.runId,
      tournamentId: payload.run.tournamentId,
      stage: payload.run.stage,
      createdAt: payload.run.createdAt,
    }))
  },
}

/**
 * Load every current run.
 *
 * Three outcomes, deliberately distinct, because they need different answers
 * from the user:
 *
 *   unconfigured  no RUN_FILE and no Supabase credentials -> set one
 *   empty         reachable, nothing to serve -> publish a run
 *   ready         serving at least one run
 *
 * A fourth outcome is not a state: a payload that fails schema validation
 * throws and takes the process with it. Serving numbers whose meaning the
 * writer and reader disagree about is worse than serving nothing.
 */
export async function loadCurrentRun(): Promise<StoreState> {
  if (config.runFiles.length > 0) {
    const runs: LoadedRun[] = []
    for (const file of config.runFiles) {
      const path = resolve(file)
      let parsed: unknown
      try {
        parsed = JSON.parse(readFileSync(path, "utf8"))
      } catch (err) {
        state = { status: "empty", reason: `cannot read RUN_FILE ${path}: ${describe(err)}` }
        return state
      }
      // Same assertion as the Supabase path. A file is a shortcut around the
      // database, not around the contract.
      assertRunPayload(parsed)
      runs.push({ payload: parsed, loadedAt: new Date().toISOString() })
    }
    state = { status: "ready", runs: sortNewestFirst(runs) }
    return state
  }

  if (!config.supabaseUrl || !config.supabaseSecretKey) {
    state = {
      status: "unconfigured",
      reason: config.supabaseUrl
        ? "SUPABASE_URL is set but SUPABASE_SECRET_KEY is not"
        : "neither RUN_FILE nor SUPABASE_URL is set",
    }
    return state
  }

  let payloads: unknown[]
  try {
    payloads = await readCurrentPayloads()
  } catch (err) {
    // Unreachable database is a deployment problem, not a corrupt one. Boot and
    // say so, so the client can tell "nothing published" from "server is down".
    state = { status: "empty", reason: `cannot reach Supabase: ${describe(err)}` }
    return state
  }

  if (payloads.length === 0) {
    state = {
      status: "empty",
      reason: "no row in public.runs has is_current = true for this tournament and stage",
    }
    return state
  }

  const loadedAt = new Date().toISOString()
  const runs = payloads.map((payload) => {
    // Throws SchemaMismatch. Not caught: see the note above.
    assertRunPayload(payload)
    return { payload, loadedAt }
  })
  state = { status: "ready", runs: sortNewestFirst(runs) }
  return state
}

/** Newest first, so `find` with no filter answers "the latest thing published". */
function sortNewestFirst(runs: LoadedRun[]): LoadedRun[] {
  return [...runs].sort((a, b) => b.payload.run.createdAt.localeCompare(a.payload.run.createdAt))
}

/**
 * Every current run, as one PostgREST request.
 *
 * There is no Postgres driver here and no `@supabase/supabase-js`, because this
 * process asks the database exactly one question, once, at boot. A dependency
 * that exists to make many queries convenient earns nothing against one.
 *
 * The result grows by one row per stage per tournament kept current, not by
 * traffic -- two rows today, at roughly 270 KB each on the wire once gzipped.
 * `TOURNAMENT_ID` and `STAGE` narrow it for a deployment that wants only one.
 */
async function readCurrentPayloads(): Promise<unknown[]> {
  const query = new URLSearchParams({
    select: "payload",
    is_current: "eq.true",
    order: "created_at.desc",
  })
  if (config.tournamentId) query.set("tournament_id", `eq.${config.tournamentId}`)
  if (config.stage) query.set("stage", `eq.${config.stage}`)

  const res = await fetch(`${config.supabaseUrl}/rest/v1/runs?${query}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    throw new Error(`GET /rest/v1/runs -> ${res.status} ${(await res.text()).slice(0, 200)}`)
  }

  const rows = (await res.json()) as { payload: unknown }[]
  return rows.map((row) => row.payload)
}

/**
 * Both header shapes, because the project spans a key migration.
 *
 * `sb_secret_...` keys are not JWTs and are sent on `apikey`; the legacy
 * `service_role` key is a JWT and PostgREST reads the role out of the bearer
 * token. Sending the bearer only when the key actually looks like a JWT means
 * either generation works without a second config flag to get wrong.
 */
function authHeaders(): Record<string, string> {
  const key = config.supabaseSecretKey
  const headers: Record<string, string> = { apikey: key }
  if (key.startsWith("ey")) headers.Authorization = `Bearer ${key}`
  return headers
}

/** Nothing to close: the reader holds no connection between requests. */
export async function closeRunStore(): Promise<void> {}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export { SchemaMismatch }
