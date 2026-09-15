/**
 * The configuration editor's view of the contract.
 *
 * `ConfigOverlay` is RE-EXPORTED from `shared/overlay-types.ts`, generated from
 * `shared/overlay-schema.json`, for exactly the reason `types/run.ts` re-exports
 * the run types rather than redeclaring them: a second hand-kept copy of a
 * contract drifts from the first silently, and here the thing that would drift
 * is the document that decides what a stat pays.
 *
 * What IS declared here is the envelope -- the shape of the editor's requests
 * and answers, which the server computes per request and no schema describes.
 */
export type { ConfigOverlay, PlayerPatch, StatPatch, TeamPatch, TraitPatch } from "@shared/overlay-types"

import type { ConfigOverlay } from "@shared/overlay-types"
import type { AvailableRun, Player, RunMeta, Scoring, Team } from "@/types/run"

/** Who the server thinks is asking. Re-asked on every admin request; this is
 * the answer to one of them, not a credential the client holds. */
export interface AdminSession {
  admin: { userId: string; email: string }
  overlaysEnabled: boolean
}

/**
 * What a document would do if published, computed by the server with exactly
 * the code that will apply it.
 *
 * A failed preview is data rather than an error: a draft halfway through a
 * rename is an ordinary thing to be looking at, and the editor has to render
 * the reasons rather than a broken page.
 */
export type OverlayPreview =
  | {
      ok: true
      changeCount: number
      notes: string[]
      emblemCount: number
      /** Entries that now say exactly what the published run says. These are the
       * overlay retiring: once a crawl has carried a correction into the config,
       * the entry is dead weight that will one day revert a deliberate change. */
      redundant: string[]
      scoring: Scoring
      teams: Team[]
      players: Player[]
    }
  | { ok: false; reasons: string[] }

/** One published version, for the history list. */
export interface OverlayVersion {
  version: number
  note: string
  authorEmail: string
  publishedAt: string
  changeCount: number
}

/** Everything the editor needs, in one answer. Fetched together because the
 * draft only means anything against the run it patches -- two requests could
 * render a form built from one run and validated against another. */
export interface AdminConfig {
  scope: { tournamentId: string; stage: string }
  run: RunMeta
  available: AvailableRun[]

  /** The run as published: what the draft is a patch ON. */
  published: {
    scoring: Scoring
    teams: Team[]
    players: Player[]
    emblemCount: number
  }

  /** The columns the sample matrices actually carry. A stat's `source` must be
   * one of these -- an admin cannot invent a measurement, so this is a list to
   * pick from and never a text field. */
  sourceColumns: string[]
  /** Players this run can rank. Anyone absent is shown as having no data. */
  measuredPlayerIds: number[]
  /** Teams this stage projects. A team absent here is out of the stage. */
  projectedTeamIds: number[]

  draft: { doc: ConfigOverlay; note: string; updatedAt: string; authorEmail: string } | null
  live: {
    version: number
    note: string
    publishedAt: string
    authorEmail: string
    changeCount: number
  } | null

  preview: OverlayPreview | null
}

/** What is sitting on top of the run the PUBLIC page is being served, as
 * `/api/run/current` reports it. Null is the normal case. */
export interface OverlayStatus {
  version: number
  note: string
  publishedAt: string
  changeCount: number
  notes: string[]
  /** Why the overlay is not being applied, when it could not be. The published
   * run is being served instead, and that has to be said rather than looking
   * like the edit simply had no effect. */
  failed: string[] | null
}
