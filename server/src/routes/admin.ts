import { Router } from "express"

import { overlayStore } from "../admin/overlay-store.js"
import {
  applyOverlay,
  countChanges,
  EMPTY_OVERLAY,
  OverlayRejected,
  redundantEntries,
  validateOverlay,
  type ConfigOverlay,
} from "../admin/overlay.js"
import { requireAdmin } from "../admin/auth.js"
import { del, insert, postgrest, rpc, upsert } from "../admin/rest.js"
import { toScoringYaml } from "../admin/yaml.js"
import { runStore } from "../run-store.js"

/**
 * The configuration editor's API.
 *
 * Six verbs over one document, and the shape of them is the safety property:
 * saving is not publishing, publishing is not editing, and reverting is
 * publishing again. Nothing here edits anything in place except the single
 * draft row, which is by definition the thing nobody is being served.
 *
 *   GET    /api/admin/session          who am I, and can I do this
 *   GET    /api/admin/config           the published run, the draft, and what
 *                                      the draft would do if published
 *   PUT    /api/admin/config/draft     save work in progress
 *   POST   /api/admin/config/publish   make the draft the live configuration
 *   POST   /api/admin/config/discard   throw the draft away
 *   GET    /api/admin/config/history   every published version, with authors
 *   POST   /api/admin/config/revert    load an old version into the draft
 *   GET    /api/admin/config/export    the YAML to write back into engine/config
 *
 * `requireAdmin` is applied to the router rather than to each route. A route
 * added later without it would be a route anyone can call, and the failure would
 * be invisible until somebody found it -- so the gate is on the door, not on
 * each of eight things behind it.
 */
export const adminRouter: Router = Router()

adminRouter.use(requireAdmin)

const OVERLAY_TABLE = "config_overlays"
const AUDIT_TABLE = "config_audit"

interface OverlayRow {
  id: string
  tournament_id: string
  stage: string
  status: "draft" | "published"
  version: number | null
  doc: ConfigOverlay
  note: string
  author_email: string
  created_at: string
  updated_at: string
  published_at: string | null
}

// ---------------------------------------------------------------------------
// session
// ---------------------------------------------------------------------------

adminRouter.get("/session", (req, res) => {
  res.set("Cache-Control", "no-store")
  res.json({ admin: req.admin, overlaysEnabled: overlayStore.enabled })
})

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

/**
 * Everything the editor needs, in one request.
 *
 * Deliberately one round trip rather than five: the draft only means anything
 * against the run it patches, and a UI that fetched them separately could render
 * a form built from one run and validated against another. They are one answer,
 * so they are one response.
 */
adminRouter.get("/config", async (req, res) => {
  const tournamentId = asString(req.query.tournamentId)
  const stage = asString(req.query.stage)

  const published = runStore.findPublished(tournamentId, stage)
  if (!published) {
    res.status(404).json({
      error: "no_such_run",
      reason: `no current run for ${tournamentId ?? "any tournament"} / ${stage ?? "any stage"}`,
      available: runStore.available,
    })
    return
  }

  const scope = { tournamentId: published.run.tournamentId, stage: published.run.stage }

  let draftRow: OverlayRow | null
  try {
    draftRow = await readDraft(scope.tournamentId, scope.stage)
  } catch (err) {
    res.status(502).json({ error: "store_unreachable", reason: describe(err) })
    return
  }

  const live = overlayStore.for(scope.tournamentId, scope.stage)
  const doc = draftRow?.doc ?? live?.doc ?? EMPTY_OVERLAY

  res.set("Cache-Control", "no-store")
  res.json({
    scope,
    run: published.run,
    available: runStore.available,

    // The run as published: what the draft is a patch ON. The editor renders
    // both this and the patched value side by side, because a form showing only
    // the result cannot say what was changed from what.
    published: {
      scoring: published.scoring,
      teams: published.teams,
      players: published.players,
      emblemCount: published.emblems.length,
    },

    // The columns the sample matrices actually carry. This is the list a stat's
    // `source` must come from -- an admin cannot invent a measurement, and
    // offering a free-text field here would let them try.
    sourceColumns: [...(published.playerSamples[0]?.stats ?? [])].sort(),

    // Which players this run can actually rank. A player absent from here is
    // shown as having no data rather than as a zero.
    measuredPlayerIds: published.playerSamples.map((s) => s.playerId),
    projectedTeamIds: published.stageProjections.map((p) => p.teamId),

    draft: draftRow
      ? {
          doc: draftRow.doc,
          note: draftRow.note,
          updatedAt: draftRow.updated_at,
          authorEmail: draftRow.author_email,
        }
      : null,

    live: live
      ? {
          version: live.version,
          note: live.note,
          publishedAt: live.publishedAt,
          authorEmail: live.authorEmail,
          changeCount: countChanges(live.doc),
        }
      : null,

    // What this document would do if published, computed exactly the way the
    // server will compute it. A preview that used different code from the thing
    // it previews is a preview of nothing.
    preview: previewOf(published, doc),
  })
})

adminRouter.get("/config/history", async (req, res) => {
  const tournamentId = asString(req.query.tournamentId) ?? ""
  const stage = asString(req.query.stage) ?? ""
  if (!tournamentId || !stage) {
    res.status(400).json({ error: "scope_required", reason: "tournamentId and stage are required." })
    return
  }

  try {
    const rows = await postgrest<OverlayRow[]>(OVERLAY_TABLE, {
      select: "version,doc,note,author_email,published_at",
      tournament_id: `eq.${tournamentId}`,
      stage: `eq.${stage}`,
      status: "eq.published",
      order: "version.desc",
      limit: "50",
    })
    res.set("Cache-Control", "no-store")
    res.json({
      versions: rows.map((row) => ({
        version: row.version,
        note: row.note,
        authorEmail: row.author_email,
        publishedAt: row.published_at,
        changeCount: countChanges(row.doc),
      })),
    })
  } catch (err) {
    res.status(502).json({ error: "store_unreachable", reason: describe(err) })
  }
})

/**
 * The YAML to write back into `engine/config/<tournament>/scoring.yaml`.
 *
 * The whole point of the overlay is that it is temporary. It corrects a table
 * between crawls; the correction belongs in the config the engine reads, or the
 * next publish silently reverts it -- and then the overlay silently re-applies
 * on top of a run that was deliberately different.
 *
 * So the editor can hand back exactly what to paste. Not a patch file and not
 * an automatic write: a human puts it in the repository, in a commit, next to
 * the comment explaining why. That is where a tournament's numbers are supposed
 * to live, and `redundantEntries` is what tells the admin when the round trip is
 * complete and the overlay can be dropped.
 */
adminRouter.get("/config/export", async (req, res) => {
  const tournamentId = asString(req.query.tournamentId)
  const stage = asString(req.query.stage)
  const published = runStore.findPublished(tournamentId, stage)
  if (!published) {
    res.status(404).json({ error: "no_such_run", available: runStore.available })
    return
  }

  let doc: ConfigOverlay
  try {
    const draft = await readDraft(published.run.tournamentId, published.run.stage)
    doc = draft?.doc ?? overlayStore.docFor(published.run.tournamentId, published.run.stage)
  } catch (err) {
    res.status(502).json({ error: "store_unreachable", reason: describe(err) })
    return
  }

  let patched
  try {
    patched = applyOverlay(published, doc).payload
  } catch (err) {
    res.status(409).json({
      error: "overlay_rejected",
      reasons: err instanceof OverlayRejected ? err.reasons : [describe(err)],
    })
    return
  }

  res.set("Cache-Control", "no-store")
  res.type("text/plain").send(toScoringYaml(patched.scoring, published.run))
})

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------

/**
 * Save the draft.
 *
 * A draft that does not APPLY is still saved, and that is a considered choice:
 * an admin halfway through renaming a stat has a document that is briefly
 * incoherent, and losing their work to make a point about validity helps
 * nobody. What it does not get is published -- the errors come back on this
 * response, the editor shows them, and `publish` refuses while any remain.
 *
 * A draft that does not PARSE is a different thing and is rejected here. The
 * store is typed on read; a row that is not a `ConfigOverlay` would be a
 * landmine for every later reader rather than a problem for its author.
 */
adminRouter.put("/config/draft", async (req, res) => {
  const body = (req.body ?? {}) as {
    tournamentId?: string
    stage?: string
    doc?: unknown
    note?: string
  }

  const published = runStore.findPublished(body.tournamentId, body.stage)
  if (!published) {
    res.status(404).json({ error: "no_such_run", available: runStore.available })
    return
  }
  const { tournamentId, stage } = published.run

  try {
    validateOverlay(body.doc)
  } catch (err) {
    res.status(400).json({
      error: "malformed_overlay",
      reasons: err instanceof OverlayRejected ? err.reasons : [describe(err)],
    })
    return
  }
  const doc = body.doc as ConfigOverlay

  try {
    const before = await readDraft(tournamentId, stage)
    const row = await upsert<OverlayRow>(
      OVERLAY_TABLE,
      {
        tournament_id: tournamentId,
        stage,
        status: "draft",
        version: null,
        doc,
        note: String(body.note ?? "").slice(0, 2000),
        author_id: req.admin!.userId,
        author_email: req.admin!.email,
        published_at: null,
      },
      // Matches the partial unique index. Two tabs saving at once write the same
      // row rather than racing to create a second draft.
      "tournament_id,stage,status",
    )
    await audit("save_draft", {
      tournamentId,
      stage,
      beforeDoc: before?.doc ?? null,
      afterDoc: doc,
      note: row.note,
      req,
    })

    res.set("Cache-Control", "no-store")
    res.json({ savedAt: row.updated_at, preview: previewOf(published, doc) })
  } catch (err) {
    res.status(502).json({ error: "store_unreachable", reason: describe(err) })
  }
})

/**
 * Publish the draft as the next version.
 *
 * Re-validated here against the run that is currently being served, not against
 * whatever run it was drafted over. A crawl can land between drafting and
 * publishing, and an overlay that was coherent against last week's roster is
 * exactly the kind of thing that must not go live unexamined.
 *
 * `note` is required. Every version in this table can be reverted to, and a
 * version nobody can explain is one nobody can safely revert to.
 */
adminRouter.post("/config/publish", async (req, res) => {
  const body = (req.body ?? {}) as { tournamentId?: string; stage?: string; note?: string }
  const note = String(body.note ?? "").trim()

  const published = runStore.findPublished(body.tournamentId, body.stage)
  if (!published) {
    res.status(404).json({ error: "no_such_run", available: runStore.available })
    return
  }
  const { tournamentId, stage } = published.run

  if (note.length < 3) {
    res.status(400).json({
      error: "note_required",
      reason:
        "Say what this changes and why. Every version here is something somebody may " +
        "later need to revert to, and one with no note is one nobody can judge.",
    })
    return
  }

  let draft: OverlayRow | null
  try {
    draft = await readDraft(tournamentId, stage)
  } catch (err) {
    res.status(502).json({ error: "store_unreachable", reason: describe(err) })
    return
  }
  if (!draft) {
    res.status(409).json({ error: "no_draft", reason: "There is nothing to publish." })
    return
  }

  try {
    applyOverlay(published, draft.doc)
  } catch (err) {
    res.status(409).json({
      error: "overlay_rejected",
      reason: "This draft does not apply to the run currently being served.",
      reasons: err instanceof OverlayRejected ? err.reasons : [describe(err)],
    })
    return
  }

  try {
    // The version number is read and written inside one transaction, under an
    // advisory lock. Doing it here would be a read-then-write from a process
    // that can have several copies of itself.
    const rows = await rpc<OverlayRow[] | OverlayRow>("publish_config_overlay", {
      p_tournament_id: tournamentId,
      p_stage: stage,
      p_note: note.slice(0, 2000),
      p_author_id: req.admin!.userId,
      p_author_email: req.admin!.email,
    })
    const row = Array.isArray(rows) ? rows[0]! : rows

    await audit("publish", {
      tournamentId,
      stage,
      version: row.version,
      beforeDoc: overlayStore.docFor(tournamentId, stage),
      afterDoc: draft.doc,
      note,
      req,
    })

    // So the admin who pressed the button sees it on their next page load.
    // Other instances of this process converge within `overlayPollSeconds`.
    overlayStore.invalidate()

    res.status(201).json({ version: row.version, publishedAt: row.published_at })
  } catch (err) {
    res.status(502).json({ error: "store_unreachable", reason: describe(err) })
  }
})

adminRouter.post("/config/discard", async (req, res) => {
  const body = (req.body ?? {}) as { tournamentId?: string; stage?: string }
  const published = runStore.findPublished(body.tournamentId, body.stage)
  if (!published) {
    res.status(404).json({ error: "no_such_run", available: runStore.available })
    return
  }
  const { tournamentId, stage } = published.run

  try {
    const before = await readDraft(tournamentId, stage)
    if (!before) {
      res.status(409).json({ error: "no_draft", reason: "There is no draft to discard." })
      return
    }
    await del(OVERLAY_TABLE, {
      tournament_id: `eq.${tournamentId}`,
      stage: `eq.${stage}`,
      status: "eq.draft",
    })
    await audit("discard_draft", {
      tournamentId,
      stage,
      beforeDoc: before.doc,
      afterDoc: null,
      note: "",
      req,
    })
    // Discarding touches no published version, so nothing being served moves.
    res.json({ discarded: true })
  } catch (err) {
    res.status(502).json({ error: "store_unreachable", reason: describe(err) })
  }
})

/**
 * Load an earlier published version into the draft.
 *
 * Deliberately not "make version 4 live again". A revert lands in the editor,
 * where it can be read against the run currently being served before anyone
 * commits to it -- and going live then means publishing, which mints a new
 * version with its own note and author. So the history stays a list of what was
 * decided, in order, rather than a stack that can be rewound.
 */
adminRouter.post("/config/revert", async (req, res) => {
  const body = (req.body ?? {}) as { tournamentId?: string; stage?: string; version?: number }
  const published = runStore.findPublished(body.tournamentId, body.stage)
  if (!published) {
    res.status(404).json({ error: "no_such_run", available: runStore.available })
    return
  }
  const { tournamentId, stage } = published.run
  const version = Number(body.version)
  if (!Number.isInteger(version) || version < 1) {
    res.status(400).json({ error: "version_required", reason: "Name the version to load." })
    return
  }

  try {
    const rows = await postgrest<OverlayRow[]>(OVERLAY_TABLE, {
      select: "doc,note,version",
      tournament_id: `eq.${tournamentId}`,
      stage: `eq.${stage}`,
      status: "eq.published",
      version: `eq.${version}`,
      limit: "1",
    })
    const source = rows[0]
    if (!source) {
      res.status(404).json({ error: "no_such_version", reason: `version ${version} not found.` })
      return
    }

    const before = await readDraft(tournamentId, stage)
    await upsert<OverlayRow>(
      OVERLAY_TABLE,
      {
        tournament_id: tournamentId,
        stage,
        status: "draft",
        version: null,
        doc: source.doc,
        note: `Loaded from version ${version}: ${source.note}`.slice(0, 2000),
        author_id: req.admin!.userId,
        author_email: req.admin!.email,
        published_at: null,
      },
      "tournament_id,stage,status",
    )
    await audit("save_draft", {
      tournamentId,
      stage,
      beforeDoc: before?.doc ?? null,
      afterDoc: source.doc,
      note: `revert to v${version}`,
      req,
    })

    res.json({ loaded: version, preview: previewOf(published, source.doc) })
  } catch (err) {
    res.status(502).json({ error: "store_unreachable", reason: describe(err) })
  }
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * What a document would do, without doing it.
 *
 * Computed by the same `applyOverlay` the request path uses, so a preview that
 * says "fine" and a publish that then fails is not a reachable state. Failure is
 * data here rather than an exception: an invalid draft is an ordinary thing to
 * be looking at while editing.
 */
function previewOf(published: ReturnType<typeof runStore.findPublished>, doc: ConfigOverlay) {
  if (!published) return null
  try {
    const applied = applyOverlay(published, doc)
    return {
      ok: true as const,
      changeCount: applied.changeCount,
      notes: applied.notes,
      emblemCount: applied.payload.emblems.length,
      // Entries that now agree with the published run. These are what the
      // overlay should shed once a crawl has carried the correction into the
      // config -- see `redundantEntries`.
      redundant: redundantEntries(published, doc),
      scoring: applied.payload.scoring,
      teams: applied.payload.teams,
      players: applied.payload.players,
    }
  } catch (err) {
    return {
      ok: false as const,
      reasons: err instanceof OverlayRejected ? err.reasons : [describe(err)],
    }
  }
}

async function readDraft(tournamentId: string, stage: string): Promise<OverlayRow | null> {
  const rows = await postgrest<OverlayRow[]>(OVERLAY_TABLE, {
    select: "id,tournament_id,stage,status,version,doc,note,author_email,created_at,updated_at,published_at",
    tournament_id: `eq.${tournamentId}`,
    stage: `eq.${stage}`,
    status: "eq.draft",
    limit: "1",
  })
  return rows[0] ?? null
}

/**
 * Record the write.
 *
 * Never allowed to fail the operation it describes. An audit row that cannot be
 * written is a real problem and it is logged as one, but refusing a publish
 * because the log is unavailable would mean the log's availability gates the
 * configuration -- and the failure would arrive as a mysterious 502 after the
 * work was already done.
 */
async function audit(
  action: "save_draft" | "publish" | "discard_draft",
  entry: {
    tournamentId: string
    stage: string
    version?: number | null
    beforeDoc: ConfigOverlay | null
    afterDoc: ConfigOverlay | null
    note: string
    req: { admin?: { userId: string; email: string } }
  },
): Promise<void> {
  try {
    await insert(AUDIT_TABLE, {
      tournament_id: entry.tournamentId,
      stage: entry.stage,
      action,
      version: entry.version ?? null,
      before_doc: entry.beforeDoc,
      after_doc: entry.afterDoc,
      note: entry.note,
      author_id: entry.req.admin?.userId ?? null,
      author_email: entry.req.admin?.email ?? "",
    })
  } catch (err) {
    console.error(`[server] could not write the config audit row for ${action}:`, describe(err))
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
