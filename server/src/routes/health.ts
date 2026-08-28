import { Router } from "express"

import { runStore } from "../run-store.js"

/**
 * GET /api/health
 *
 * Says which of the three load states the process is in and why. A boot that
 * silently serves nothing is indistinguishable from a boot that silently serves
 * something stale, so the reason travels with the status.
 */
export const healthRouter: Router = Router()

healthRouter.get("/health", (_req, res) => {
  const state = runStore.state

  res.json({
    status: state.status,
    ...(state.status === "ready"
      ? {
          runId: state.payload.run.runId,
          tournamentId: state.payload.run.tournamentId,
          stage: state.payload.run.stage,
          loadedAt: state.loadedAt,
          gatesForced: state.payload.run.gatesForced,
        }
      : { reason: state.reason }),
  })
})
