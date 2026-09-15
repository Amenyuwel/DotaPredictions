import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { overlayStore } from "./admin/overlay-store.js"
import { applyOverlay, OverlayRejected } from "./admin/overlay.js"
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
   * The run a request means, WITH the configuration overlay in force.
   *
   * Both arguments are optional and both narrow: no arguments means the newest
   * run of any stage, which is what a first page load asks for. An unmatched
   * request returns null rather than falling back to a different stage --
   * answering a Group Stage question with Main Event numbers would be a wrong
   * answer wearing the right shape.
   *
   * Every scoring path in this server goes through here, which is the reason it
   * is the overlay's only entry point. A second accessor returning the
   * unpatched run would eventually be used by one route, and that route would
   * disagree with the other four about what a stat pays -- while all five
   * looked right.
   */
  find(tournamentId?: string, stage?: string): RunPayload | null {
    const published = runStore.findPublished(tournamentId, stage)
    return published ? effectiveOf(published) : null
  },

  /**
   * The run exactly as it was published, overlay and all ignored.
   *
   * For the admin routes only, and for one reason: an overlay is edited AGAINST
   * the published run, so the editor has to be able to see what it is patching.
   * Scoring an answer from this would be scoring from a table the reader is not
   * being shown.
   */
  findPublished(tournamentId?: string, stage?: string): RunPayload | null {
    const match = runStore.runs.find(
      ({ payload }) =>
        (!tournamentId || payload.run.tournamentId === tournamentId) &&
        (!stage || payload.run.stage === stage),
    )
    return match?.payload ?? null
  },

  /** What is on top of a run, for the client to report and for a cache to key
   * on. Null when the run is being served exactly as published. */
  overlayFor(payload: RunPayload): OverlayStatus | null {
    const { tournamentId, stage } = payload.run
    const overlay = overlayStore.for(tournamentId, stage)
    if (!overlay) return null
    const applied = effective.get(cacheKey(payload.run.runId))
    return {
      version: overlay.version,
      note: overlay.note,
      publishedAt: overlay.publishedAt,
      changeCount: applied?.changeCount ?? 0,
      notes: applied?.notes ?? [],
      failed: applied?.failed ?? null,
    }
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
 * What is sitting on top of a published run, as the client is told it.
 *
 * Reported rather than merely applied. A reader acting on a projection is
 * entitled to know that a number in it was changed by hand this afternoon and
 * has not been through a crawl -- the same reason `FactorReport` carries a
 * `kind` and `gatesForced` travels on the run.
 */
export interface OverlayStatus {
  version: number
  note: string
  publishedAt: string
  changeCount: number
  notes: string[]
  /** Why the overlay is NOT being applied, when it could not be. The published
   * run is being served untouched, and that has to be said out loud: an admin
   * looking at their own edit having no effect deserves the reason. */
  failed: string[] | null
}

interface Effective {
  generation: number
  payload: RunPayload
  notes: string[]
  changeCount: number
  failed: string[] | null
}

/**
 * Patched runs, one per published run, rebuilt when the overlay generation
 * moves.
 *
 * Cached because `applyOverlay` rebuilds the whole emblem catalog -- 450 rows
 * for TI 2026 -- and revalidates the result against the run schema, which is
 * far too much to do per request and exactly the right amount to do per
 * publish. Keyed on runId and checked against `overlayStore.generation`, so a
 * stale entry is impossible rather than unlikely: the generation is the same
 * token `resetMemos` fires on.
 */
const effective = new Map<string, Effective>()

const cacheKey = (runId: string) => runId

function effectiveOf(published: RunPayload): RunPayload {
  const key = cacheKey(published.run.runId)
  const generation = overlayStore.generation
  const hit = effective.get(key)
  if (hit && hit.generation === generation) return hit.payload

  const { tournamentId, stage } = published.run
  const doc = overlayStore.docFor(tournamentId, stage)

  let entry: Effective
  try {
    const applied = applyOverlay(published, doc)
    entry = {
      generation,
      payload: applied.payload,
      notes: applied.notes,
      changeCount: applied.changeCount,
      failed: null,
    }
  } catch (err) {
    // An overlay that cannot be applied does NOT take the public tool down, and
    // it does not get half-applied. The published run is served exactly as it
    // was published, the reason is attached to it, and the admin page shows the
    // same list. This is reachable in one realistic way: an overlay published
    // against one run, then a NEW run published whose columns or roster no
    // longer support it. The correct answer then is the engine's, not a
    // partially patched hybrid of the two.
    const reasons =
      err instanceof OverlayRejected ? err.reasons : [err instanceof Error ? err.message : String(err)]
    console.warn(
      `[server] overlay for ${tournamentId}/${stage} does not apply to run ` +
        `${published.run.runId}; serving the published run untouched:\n  ${reasons.join("\n  ")}`,
    )
    entry = { generation, payload: published, notes: [], changeCount: 0, failed: reasons }
  }

  effective.set(key, entry)
  return entry.payload
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
