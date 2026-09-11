/**
 * The only module that knows the server exists.
 *
 * Everything above it works in the types from `@/types/run`, never in fetch
 * responses, so a change to transport or URL shape stops here. Same boundary
 * rule the engine keeps between `sources/` and its models.
 */
import type { AnswerResponse, BannerAnswer, CurrentRun, FantasyRole, Stage } from "@/types/run"

/** Thrown for any non-2xx.
 *
 * Carries the status so callers can tell "the server is broken" (500) from a
 * request it actually rejected, and carries the server's own `error` code and
 * `reason` so they can tell one 404 from another. That second part is
 * load-bearing: "nothing published for this stage" and "that team is not in
 * this stage" are both 404, and the first one's fix -- run `publish.py` -- is
 * useless advice for the second. */
export class ApiError extends Error {
  // Declared rather than constructor parameter properties: the client compiles
  // with `erasableSyntaxOnly`, which forbids syntax that emits runtime code.
  readonly status: number
  /** The server's machine-readable `error`, when it sent one. */
  readonly code: string | null
  /** The server's own sentence about what went wrong. Preferred over anything
   * written here, because it is the side that knows. */
  readonly reason: string | null

  constructor(message: string, status: number, code: string | null, reason: string | null) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.reason = reason
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  })
  if (!res.ok) {
    // A failure body is best-effort: a proxy or a load balancer answering for a
    // server that is not there sends HTML, and losing the status to a parse
    // error would turn "nothing is listening" into "something unknown broke".
    let code: string | null = null
    let reason: string | null = null
    try {
      const body = (await res.json()) as { error?: string; reason?: string }
      code = body.error ?? null
      reason = body.reason ?? null
    } catch {
      // no JSON body; the status is the whole message
    }
    throw new ApiError(
      `${init?.method ?? "GET"} ${path} -> ${res.status}`,
      res.status,
      code,
      reason,
    )
  }
  return (await res.json()) as T
}

export function getCurrentRun(tournamentId?: string, stage?: Stage) {
  const q = new URLSearchParams()
  if (tournamentId) q.set("tournamentId", tournamentId)
  if (stage) q.set("stage", stage)
  const qs = q.toString()
  return request<CurrentRun>(`/api/run/current${qs ? `?${qs}` : ""}`)
}

export interface RankRequest {
  emblems: { emblemId: string; order: number }[]
  /** Required: core and support are duos, mid is one player, so the unit being
   * ranked depends on which slot the banner is for. */
  role: FantasyRole
  /** Which run to score against. Omitted means the newest, which is only
   * correct on a page that is not offering a choice. */
  tournamentId?: string
  stage?: Stage
}

export function rankPlayers(body: RankRequest) {
  return request<AnswerResponse>("/api/player/rank", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export interface OptimizeRequest {
  /** Which slot wears the banner. Core and support are duos, mid is one
   * player, and the same emblems are worth different amounts to each. */
  role: FantasyRole
  teamId: number
  /** The emblems you own. Unordered: the order is what is being asked for. */
  inventory: { emblemId: string }[]
  tournamentId?: string
  stage?: Stage
}

export function optimiseBanner(body: OptimizeRequest) {
  return request<BannerAnswer>("/api/banner/optimize", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export interface TargetRequest {
  /** Which slot wears the banner. Core and support are duos, mid is one
   * player, and the same emblems are worth different amounts to each. */
  role: FantasyRole
  teamId: number
  /** Which rung of the ladder to answer. Omitted is the realistic one -- the
   * ceiling is a number to know, not the thing to aim at. */
  goal?: string
  /** For `goal: "custom"`: the quality of each emblem you actually have, one
   * per slot. Refused rather than trimmed if it is the wrong length. */
  qualities?: string[]
  tournamentId?: string
  stage?: Stage
}

/** The banner to go and roll for, over the whole catalog. No inventory: what
 * you own is the other question. */
export function targetBanner(body: TargetRequest) {
  return request<BannerAnswer>("/api/banner/target", {
    method: "POST",
    body: JSON.stringify(body),
  })
}
