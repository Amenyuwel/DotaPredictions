import { createApp } from "./app.js"
import { config } from "./config.js"
import { closeRunStore, loadCurrentRun, SchemaMismatch } from "./run-store.js"

/**
 * Boot: load the run, then listen.
 *
 * The load runs before the first request so a schema mismatch kills the process
 * at startup rather than on someone's page view. A missing run does not stop
 * the boot -- the API reports it, which is how the client tells "nothing
 * published" apart from "server down".
 */
async function main(): Promise<void> {
  try {
    const state = await loadCurrentRun()
    if (state.status === "ready") {
      const { run } = state.payload
      console.log(
        `[server] serving ${run.tournamentId}/${run.stage} run ${run.runId} ` +
          `(${state.payload.playerSamples.length} player samples, ` +
          `${state.payload.stageProjections.length} projections)`,
      )
      if (run.gatesForced.length > 0) {
        console.warn(
          `[server] this run was published with ${run.gatesForced.length} freshness ` +
            `gate(s) overridden: ${run.gatesForced.join(", ")}`,
        )
      }
    } else {
      console.warn(`[server] no run loaded (${state.status}): ${state.reason}`)
    }
  } catch (err) {
    if (err instanceof SchemaMismatch) {
      console.error(
        "[server] refusing to start: the published run does not match the contract.\n" +
          "Serving it would mean the writer and the reader disagree about what the\n" +
          "bytes mean, and every number computed from it would be wrong.\n",
      )
      console.error(err.message)
      process.exit(1)
    }
    throw err
  }

  const server = createApp().listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port}`)
  })

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      server.close(() => {
        void closeRunStore().then(() => process.exit(0))
      })
    })
  }
}

void main()
