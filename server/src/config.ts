import { config as loadEnv } from "dotenv"

loadEnv()

/**
 * Every knob the process has, resolved once.
 *
 * Read from the environment here and nowhere else, so a deployment question is
 * answered by one file rather than by grepping for process.env.
 */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  mongoUri: process.env.MONGODB_URI ?? "",
  mongoDb: process.env.MONGODB_DB ?? "dotapredictions",

  /** Which snapshot to serve at boot. Empty means "newest current run". */
  tournamentId: process.env.TOURNAMENT_ID ?? "",
  stage: process.env.STAGE ?? "",

  /** Spec: 60 requests per minute per IP, since there is no auth. */
  rateLimit: { windowMs: 60_000, max: 60 },

  /** Runs are immutable, so the current run can be cached hard. */
  runCacheSeconds: 3600,

  isProduction: process.env.NODE_ENV === "production",
} as const
