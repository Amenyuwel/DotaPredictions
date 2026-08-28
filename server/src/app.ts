import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

import express, { type Express, type NextFunction, type Request, type Response } from "express"
import rateLimit from "express-rate-limit"

import { config } from "./config.js"
import { healthRouter } from "./routes/health.js"
import { rankRouter } from "./routes/rank.js"
import { runRouter } from "./routes/run.js"

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

  app.use("/api", healthRouter)
  app.use("/api", runRouter)
  app.use("/api", rankRouter)

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not_found" })
  })

  serveClient(app)

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[server]", err)
    res.status(500).json({ error: "internal", reason: err.message })
  })

  return app
}

/**
 * In production the client is served from here, which is the whole reason there
 * is no CORS configuration anywhere in this repo: one origin, by construction.
 * In development Vite serves it and proxies /api back.
 */
function serveClient(app: Express): void {
  const dist = fileURLToPath(new URL("../../client/dist", import.meta.url))
  if (!existsSync(dist)) return

  app.use(express.static(dist))
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(`${dist}/index.html`)
  })
}
