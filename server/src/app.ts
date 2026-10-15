import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

import express, { type Express, type NextFunction, type Request, type Response } from "express"
import rateLimit from "express-rate-limit"

import { overlayMiddleware } from "./admin/overlay-store.js"
import { config } from "./config.js"
import { adminRouter } from "./routes/admin.js"
import { healthRouter } from "./routes/health.js"
import { optimizeRouter } from "./routes/optimize.js"
import { rankRouter } from "./routes/rank.js"
import { runRouter } from "./routes/run.js"
import { targetRouter } from "./routes/target.js"

/**
 * Wiring only. Every module below answers one question; this file is the only
 * place that knows the order they answer it in.
 */
export function createApp(): Express {
  const app = express()

  // Behind a proxy in production, so the rate limiter keys on the real client
  // rather than on the proxy's single address.
  if (config.isProduction) app.set("trust proxy", 1)

  app.use(express.json({ limit: "64kb" }))
  app.use(
    "/api",
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      limit: config.rateLimit.max,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "rate_limited", reason: "60 requests per minute per IP" },
    }),
  )

  // Before every route that reads a run, because the run a request means is the
  // published one with the current overlay on it. Cheap by construction: a
  // clock comparison per request, and one small read per `overlayPollSeconds`.
  app.use("/api", overlayMiddleware)

  app.use("/api", healthRouter)
  app.use("/api", runRouter)
  app.use("/api", rankRouter)
  app.use("/api", optimizeRouter)
  app.use("/api", targetRouter)

  // Last, and every route inside it carries `requireAdmin`. Mounted here rather
  // than beside the others to keep the one group of endpoints that WRITES
  // visually separate from the four that only answer questions.
  app.use("/api/admin", adminRouter)

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not_found" })
  })

  serveClient(app)

  // The message is logged in full and sent only off production. Everything
  // reaching here is unhandled, which means it can be anything -- and the
  // things it most often is are `RestError`s carrying a table name and three
  // hundred characters of the database's own response. Those belong in the log,
  // where the operator reads them, not in a reply to an anonymous caller on a
  // route with no authentication. The routes that DO explain themselves to a
  // requester are the admin ones, which say `describe(err)` deliberately and
  // sit behind `requireAdmin`.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[server]", err)
    res.status(500).json({
      error: "internal",
      reason: config.isProduction ? "unexpected server error" : err.message,
    })
  })

  return app
}

/**
 * In production the client is served from here, which is the whole reason there
 * is no CORS configuration anywhere in this repo: one origin, by construction.
 * In development Vite serves it and proxies /api back.
 */
function serveClient(app: Express): void {
  // Two levels up from src/ (tsx) but four from dist/server/src/ (npm start),
  // because tsc's rootDir is the repo root. Only one of them exists.
  const dist = ["../../client/dist", "../../../../client/dist"]
    .map((rel) => fileURLToPath(new URL(rel, import.meta.url)))
    .find((candidate) => existsSync(candidate))
  if (!dist) return

  app.use(express.static(dist))
  // The SPA shell for routes only. A path ending in a file extension that
  // static did not find is a missing FILE, and answering it with index.html
  // and a 200 hid that: every <img> for an absent player photo downloaded the
  // HTML page, failed to decode, and was asked for again on the next render.
  // A 404 says what happened, and is what an image's onError expects.
  app.get(/^(?!\/api\/).*/, (req, res) => {
    if (/\.[a-z0-9]+$/i.test(req.path)) {
      res.status(404).end()
      return
    }
    res.sendFile(`${dist}/index.html`)
  })
}
