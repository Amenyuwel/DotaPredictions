import { resolve } from "node:path"

import { config as loadEnv } from "dotenv"

/**
 * One .env for the monorepo, with a server-local override.
 *
 * The engine and the client already read the repo-root file -- the client's
 * Vite config points `envDir` at it -- so the Supabase credentials are written
 * down once. `server/.env` still wins where both define a name, which is what
 * makes a deployment-specific PORT or RUN_FILE possible without copying the
 * keys beside it. dotenv does not overwrite a name it has already seen, so
 * order here IS the precedence.
 */
loadEnv({ path: [resolve(process.cwd(), ".env"), resolve(process.cwd(), "..", ".env")] })

/**
 * Every knob the process has, resolved once.
 *
 * Read from the environment here and nowhere else, so a deployment question is
 * answered by one file rather than by grepping for process.env.
 */
export const config = {
  port: Number(process.env.PORT ?? 3000),

  /**
   * Load runs from files instead of Supabase. These are what `publish.py --out`
   * writes, validated by the same schema on the same path, so they are real
   * runs and not fixtures -- they just skip the database. Takes precedence over
   * SUPABASE_URL when set.
   *
   * Comma-separated, because a tournament has stages: one file per stage is the
   * offline equivalent of one current row per stage, and a dev path that could
   * only ever hold one run would stop being a rehearsal of the real one.
   */
  runFiles: (process.env.RUN_FILE ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),

  supabaseUrl: (process.env.SUPABASE_URL ?? "").replace(/\/+$/, ""),

  /**
   * The secret key (`sb_secret_...`), server-side only. It carries BYPASSRLS,
   * which is exactly why `runs` has row-level security on and no policy: this
   * process is the only reader, and a browser key reaching that table returns
   * nothing rather than everything.
   */
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY ?? "",

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

  /**
   * The banner search, which is the same estimator run at two precisions.
   *
   * `screenSims` scores every legal arrangement of the inventory; `keep`
   * distinct emblem sets are then rescored at `scoring.sims` with a bootstrap
   * interval. The screen re-seeds identically per candidate, so it compares
   * them on one simulated schedule drawing one set of games -- which is why a
   * couple of hundred simulations separate banners there and would not here.
   *
   * `maxInventory` is a latency bound, not a rule of the game. Owned emblems in
   * `run.bannerSlots` slots is a permutation count: twelve in five is 95,040
   * arrangements, 47,520 once mirror images are folded together, and that is
   * the point where an exhaustive screen still fits inside a request. Raising
   * it costs roughly a factor per extra emblem.
   *
   * `targetShortlist` is the one narrowing left in `/api/banner/target`. Since
   * slot colours went in, that search is exhaustive over stats -- each slot has
   * six candidates, not eighteen -- but the candidate count still runs to
   * 303,750 for mid, whose row carries all three colours. Every one of them is
   * priced on its recency-weighted mean, which is exact and costs a dot
   * product; only this many go on to the Monte Carlo screen. The mean ranks
   * badly against E[best series], which is the whole reason the screen exists,
   * so the bound is set far above `keep`: it is there to drop candidates that
   * are not in the running, not to pick the winner.
   */
  search: { screenSims: 240, keep: 10, maxInventory: 12, targetShortlist: 3000 },

  /** Runs are immutable, so the current run can be cached hard. */
  runCacheSeconds: 3600,

  isProduction: process.env.NODE_ENV === "production",
} as const
