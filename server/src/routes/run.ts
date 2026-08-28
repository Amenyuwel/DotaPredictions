import { Router } from "express"

import { config } from "../config.js"
import { runStore } from "../run-store.js"

/**
 * GET /api/run/current
 *
 * Returns the metadata and catalogues a client needs to build a request: the
 * run itself, the teams, the players and the emblem catalogue. Deliberately NOT
 * the sample matrices -- those are megabytes of Float32 that only the scorer
 * reads, and shipping them to a browser would be sending data to be ignored.
 */
export const runRouter: Router = Router()

runRouter.get("/run/current", (_req, res) => {
  const state = runStore.state

  if (state.status !== "ready") {
    // 404 rather than 500: there is nothing wrong with this server, there is
    // simply nothing published. The client renders that as an instruction.
    res.status(404).json({
      error: "no_current_run",
      reason: state.reason,
      hint:
        state.status === "unconfigured"
          ? "Set MONGODB_URI, then publish a run from engine/."
          : "Publish one with `python -m scripts.publish` from engine/.",
    })
    return
  }

  const { run, teams, players, emblems } = state.payload
  res.set("Cache-Control", `public, max-age=${config.runCacheSeconds}`)
  res.json({ run, teams, players, emblems })
})
