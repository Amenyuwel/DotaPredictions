import { Router } from "express"

import { config } from "../config.js"
import { runStore } from "../run-store.js"

/**
 * GET /api/run/current?tournamentId=&stage=
 *
 * Returns the metadata and catalogues a client needs to build a request: the
 * run itself, the teams, the players, the emblem catalogue and the scoring
 * table. Deliberately NOT the sample matrices -- those are megabytes of Float32
 * that only the scorer reads, and shipping them to a browser would be sending
 * data to be ignored.
 *
 * `scoring` travels because an emblem's COLOUR lives there (`stats[stat].color`)
 * and nowhere else in the payload. The alternative -- stamping a colour onto
 * each emblem row here -- would be a second copy of a table that already exists,
 * and two copies of a scoring table drift silently.
 *
 * Both query parameters narrow; neither is required. With none, the newest run
 * of any stage answers, which is what a cold page load means. `available` ships
 * alongside so the client can offer the others without a second round trip --
 * and so a stage with no published run is absent from the switcher rather than
 * selectable and then broken.
 */
export const runRouter: Router = Router()

runRouter.get("/run/current", (req, res) => {
  const state = runStore.state

  if (state.status !== "ready") {
    // 404 rather than 500: there is nothing wrong with this server, there is
    // simply nothing published. The client renders that as an instruction.
    res.status(404).json({
      error: "no_current_run",
      reason: state.reason,
      hint:
        state.status === "unconfigured"
          ? "Set RUN_FILE to a `publish.py --out` payload, or SUPABASE_URL and SUPABASE_SECRET_KEY."
          : "Publish one with `python -m scripts.publish` from engine/.",
    })
    return
  }

  const tournamentId = asString(req.query.tournamentId)
  const stage = asString(req.query.stage)
  const payload = runStore.find(tournamentId, stage)

  if (!payload) {
    // Asked for a stage nobody has published. Not a fallback to another stage:
    // a Group Stage question answered with Main Event numbers is a wrong answer
    // wearing the right shape.
    res.status(404).json({
      error: "no_such_run",
      reason: `no current run for ${tournamentId ?? "any tournament"} / ${stage ?? "any stage"}`,
      hint: "Publish it with `python -m scripts.publish --stage <stage>` from engine/.",
      available: runStore.available,
    })
    return
  }

  const { run, scoring, teams, players, emblems } = payload
  res.set("Cache-Control", `public, max-age=${config.runCacheSeconds}`)
  res.json({
    run,
    scoring,
    teams,
    players,
    emblems,
    // The teams this stage actually projects, which is NOT every team with a
    // roster in the payload. A Main Event run carries all sixteen rosters and
    // eight projections, so a picker built from `teams` would offer eight sides
    // that were knocked out -- selectable, and then a 404. Same rule as the
    // stage switcher: what cannot be answered is absent rather than offered.
    stageTeamIds: payload.stageProjections.map((p) => p.teamId),
    // Not a property of the run -- a property of THIS server's latency budget.
    // It ships with the run anyway because the client must not offer a choice
    // the server will refuse, and a second copy of the number in the browser
    // would start refusing at the wrong place the day this one is tuned.
    limits: { maxInventory: config.search.maxInventory },
    available: runStore.available,
  })
})

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}
