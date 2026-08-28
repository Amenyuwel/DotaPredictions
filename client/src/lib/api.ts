/**
 * The only module that knows the server exists.
 *
 * Everything above it works in the types from `@/types/run`, never in fetch
 * responses, so a change to transport or URL shape stops here. Same boundary
 * rule the engine keeps between `sources/` and its models.
 */
import type { AnswerResponse, CurrentRun, Stage } from "@/types/run"

/** Thrown for any non-2xx. Carries the status so callers can tell "no run
 * published yet" (404) from "the server is broken" (500) — different problems
 * with different answers for the user. */
export class ApiError extends Error {
  // Declared rather than a constructor parameter property: the client compiles
  // with `erasableSyntaxOnly`, which forbids syntax that emits runtime code.
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  })
  if (!res.ok) {
    throw new ApiError(`${init?.method ?? "GET"} ${path} -> ${res.status}`, res.status)
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
  tournamentId: string
  stage: Stage
  emblems: { emblemId: string; order: number }[]
  role?: "core" | "mid" | "support"
}

export function rankPlayers(body: RankRequest) {
  return request<AnswerResponse>("/api/player/rank", {
    method: "POST",
    body: JSON.stringify(body),
  })
}
