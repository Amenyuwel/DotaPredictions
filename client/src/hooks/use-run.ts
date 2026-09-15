import { useQuery } from "@tanstack/react-query"

import { getCurrentRun } from "@/lib/api"
import type { Stage } from "@/types/run"

/**
 * The current published run.
 *
 * `staleTime` mirrors the `Cache-Control: public, max-age=3600` the server sets
 * on this endpoint: a run is immutable, so re-fetching it inside the hour can
 * only cost a request. Retries are off for 404 because "nothing published yet"
 * is a state to render, not a failure to retry.
 */
export function useRun(tournamentId?: string, stage?: Stage) {
  return useQuery(runQueryOptions(tournamentId, stage))
}

/**
 * The same query, as options, for a caller that needs several at once.
 *
 * The account page lists saved work across every tournament and stage, and a
 * saved roster holds player ids rather than names -- so it has to resolve each
 * group against its own run, which is `useQueries` and not a hook it can call
 * in a loop. Shared rather than rewritten there because the KEY is the shared
 * part: a second spelling of `["run", id, stage]` would fetch a second copy of
 * a payload this cache already holds, and the two could disagree about which
 * run is current.
 */
export function runQueryOptions(tournamentId?: string, stage?: Stage) {
  return {
    queryKey: ["run", tournamentId ?? "latest", stage ?? "latest"] as const,
    queryFn: () => getCurrentRun(tournamentId, stage),
    staleTime: 60 * 60 * 1000,
    retry: false,
  }
}
