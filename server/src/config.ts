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

  /**
   * Load a run from a file instead of Mongo. This is what `publish.py --out`
   * writes, validated by the same schema on the same path, so it is a real run
   * and not a fixture -- it just skips the database. Takes precedence over
   * MONGODB_URI when set.
   */
  runFile: process.env.RUN_FILE ?? "",

  mongoUri: process.env.MONGODB_URI ?? "",
  mongoDb: process.env.MONGODB_DB ?? "dotapredictions",

  /** Which snapshot to serve at boot. Empty means "newest current run". */
  tournamentId: process.env.TOURNAMENT_ID ?? "",
  stage: process.env.STAGE ?? "",

  /** Spec: 60 requests per minute per IP, since there is no auth. */
  rateLimit: { windowMs: 60_000, max: 60 },

  /**
   * Monte Carlo budget per ranked unit. Every score here is an estimate, and
   * these two numbers are the whole latency/precision trade: sims sets the
   * noise on a score, boot sets the noise on its interval. Tune against
   * measured latency rather than by guessing.
   */
  scoring: { sims: 2000, boot: 60, seed: 20260813 },

  /** Runs are immutable, so the current run can be cached hard. */
  runCacheSeconds: 3600,

  isProduction: process.env.NODE_ENV === "production",
} as const
