import type { NextFunction, Request, Response } from "express"

import { config } from "../config.js"
import { resetMemos } from "../memo.js"
import { adminAvailable } from "./auth.js"
import { EMPTY_OVERLAY, type ConfigOverlay } from "./overlay.js"
import { postgrest } from "./rest.js"

/**
 * The published overlays, held in memory.
 *
 * Documents only. This module does not know what a run is and never applies
 * anything -- `run-store.ts` owns that, and keeping the two apart is what stops
 * the import cycle that the obvious arrangement produces.
 *
 * Refreshed lazily, from the request path, rather than on a timer. A server
 * nobody is using should not be polling a database, and a request is the only
 * moment the answer can be wrong in a way anyone notices. The cost is one
 * `Date.now()` comparison per request and, at most once every
 * `overlayPollSeconds`, one PostgREST read of a few hundred bytes.
 */

export interface PublishedOverlay {
  tournamentId: string
  stage: string
  version: number
  doc: ConfigOverlay
  note: string
  publishedAt: string
  authorEmail: string
}

interface Row {
  tournament_id: string
  stage: string
  version: number
  doc: ConfigOverlay
  note: string
  published_at: string
  author_email: string
}

/** Keyed `${tournamentId}/${stage}`. Absent means no overlay, which is the
 * normal state and not an error. */
let overlays = new Map<string, PublishedOverlay>()
let fetchedAtMs = 0
let inFlight: Promise<void> | null = null

/**
 * Which read is the newest.
 *
 * Reads are concurrent and the network does not preserve their order: a request
 * issued at t=0 can return after one issued at t=1, and applying it would
 * install older documents over newer ones -- silently, and for a whole poll
 * interval. Each read takes a ticket on the way out and drops its result on the
 * way back in if a later one has since been issued.
 */
let refreshSeq = 0

/**
 * A token that changes whenever the effective configuration changes.
 *
 * Every cached answer in this process is keyed on it, so "the overlay moved"
 * and "every memo is stale" are the same event rather than two that have to be
 * kept in step. It is a counter and not a hash of the documents: two publishes
 * that happen to produce identical documents are still two publishes, and a
 * counter cannot collide.
 */
let generation = 0

export const overlayStore = {
  get generation(): number {
    return generation
  },

  /** The overlay in force for a stage, or null. */
  for(tournamentId: string, stage: string): PublishedOverlay | null {
    return overlays.get(`${tournamentId}/${stage}`) ?? null
  },

  /** Its document, or the empty overlay -- so callers do not branch. */
  docFor(tournamentId: string, stage: string): ConfigOverlay {
    return overlayStore.for(tournamentId, stage)?.doc ?? EMPTY_OVERLAY
  },

  get all(): PublishedOverlay[] {
    return [...overlays.values()]
  },

  /** Whether this deployment can have overlays at all. A `RUN_FILE` server with
   * no Supabase credentials cannot, and its answers are therefore exactly the
   * published run -- which is worth being able to state rather than infer. */
  get enabled(): boolean {
    return adminAvailable()
  },

  /**
   * Forget the cached documents and re-read on the next request.
   *
   * Called by the admin routes immediately after a publish, so the admin who
   * pressed the button sees the effect on the next page load rather than after
   * the poll interval. Other instances of this process get there on their own
   * within `overlayPollSeconds`, which is the honest bound and the reason that
   * number is small.
   */
  invalidate(): void {
    fetchedAtMs = 0
  },
}

/**
 * Re-read the overlays if they have aged out.
 *
 * Installed as middleware in front of `/api`, so every answer this server gives
 * is computed from an overlay at most `overlayPollSeconds` old. Failures here
 * are swallowed on purpose: the last known overlay keeps serving and the run
 * underneath it is still correct. The alternative -- failing the request --
 * would take the whole public tool down because an admin's configuration table
 * was briefly unreachable, which is a worse answer than a slightly stale one.
 */
async function ensureFreshOverlays(): Promise<void> {
  if (!overlayStore.enabled) return
  if (Date.now() - fetchedAtMs < config.overlayPollSeconds * 1000) return

  // One read even under a burst: the second concurrent caller waits on the
  // first rather than issuing its own.
  inFlight ??= refresh().finally(() => {
    inFlight = null
  })
  await inFlight
}

/**
 * Re-read now, and do not join a read that is already running.
 *
 * For the publish path, and the distinction is the whole point. By the time
 * `POST /config/publish` runs its write, `overlayMiddleware` has usually
 * already fired a background read for that same request -- one that was issued
 * BEFORE the row existed. Awaiting `ensureFreshOverlays` would join it and come
 * back with the state from a moment ago, which is indistinguishable from the
 * publish not having worked.
 *
 * So this issues its own read unconditionally. It is the one caller that knows
 * something changed, rather than suspecting it might have.
 */
export async function forceRefreshOverlays(): Promise<void> {
  fetchedAtMs = 0
  await refresh()
}

export function overlayMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  // Deliberately not awaited into the request: `ensureFreshOverlays` never
  // rejects, and a request should not wait on a refresh it did not need. The
  // first request after the interval triggers the read; the handful that arrive
  // during it answer from the previous documents, at most one interval stale.
  void ensureFreshOverlays()
  next()
}

async function refresh(): Promise<void> {
  const before = fetchedAtMs
  // Set first. A failing read must not retry on every request for the rest of
  // the interval -- that turns an unreachable database into a request-rate
  // amplifier against it.
  fetchedAtMs = Date.now()
  const seq = ++refreshSeq

  try {
    // Every published version, newest first; the first row per stage wins.
    // `version=desc` rather than `published_at=desc` because the version number
    // is assigned under a lock and a timestamp is not: two publishes inside the
    // same millisecond have an order, and it is this one.
    const rows = await postgrest<Row[]>("config_overlays", {
      select: "tournament_id,stage,version,doc,note,published_at,author_email",
      status: "eq.published",
      order: "tournament_id.asc,stage.asc,version.desc",
    })

    // A later read has been issued since this one went out, so this answer is
    // already history. Dropping it is what keeps a slow read from installing
    // older documents over newer ones.
    if (seq !== refreshSeq) return

    const next = new Map<string, PublishedOverlay>()
    for (const row of rows) {
      const key = `${row.tournament_id}/${row.stage}`
      if (next.has(key)) continue // an older version of a stage already resolved
      next.set(key, {
        tournamentId: row.tournament_id,
        stage: row.stage,
        version: row.version,
        doc: row.doc,
        note: row.note,
        publishedAt: row.published_at,
        authorEmail: row.author_email,
      })
    }

    if (!sameOverlays(overlays, next)) {
      overlays = next
      generation += 1
      // Every memoised answer in this process was computed against the previous
      // configuration. Clearing them all is blunt and correct: an overlay change
      // can move any score, and a cache that is cleverly partially invalidated
      // is a cache that is one day wrong in a way nobody can reproduce.
      resetMemos()
      console.log(
        `[server] configuration overlays changed (generation ${generation}): ` +
          `${[...next.values()].map((o) => `${o.tournamentId}/${o.stage} v${o.version}`).join(", ") || "none"}`,
      )
    }
  } catch (err) {
    // Degrade, never fail the run. Keep serving the last known overlays.
    fetchedAtMs = before === 0 ? Date.now() : fetchedAtMs
    console.warn(
      `[server] could not read configuration overlays, serving the previous set: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/** Version numbers alone. The document behind a version is immutable, so two
 * maps with the same stages at the same versions are the same configuration --
 * no need to compare the documents themselves. */
function sameOverlays(
  a: Map<string, PublishedOverlay>,
  b: Map<string, PublishedOverlay>,
): boolean {
  if (a.size !== b.size) return false
  for (const [key, value] of a) {
    if (b.get(key)?.version !== value.version) return false
  }
  return true
}
