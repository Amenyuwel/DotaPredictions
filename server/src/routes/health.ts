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
          // Every loaded run, not just the newest. A deployment serving one
          // stage and a deployment serving two are different situations, and
          // the difference is invisible if health reports only the first.
          runs: state.runs.map(({ payload, loadedAt }) => ({
            runId: payload.run.runId,
            tournamentId: payload.run.tournamentId,
            stage: payload.run.stage,
            loadedAt,
            gatesForced: payload.run.gatesForced,
          })),
        }
      : { reason: state.reason }),
  })
})
